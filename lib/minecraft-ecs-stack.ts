import { Stack, StackProps,Arn,ArnFormat } from "aws-cdk-lib";
import { Construct } from "constructs";

import {Vpc, SubnetType, SecurityGroup, Peer, Port}  from "aws-cdk-lib/aws-ec2";
import { FileSystem } from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Cluster, FargateTaskDefinition,ContainerImage,Protocol,FargateService,FargatePlatformVersion } from "aws-cdk-lib/aws-ecs";
import { ACTIONS } from "./utils";

export interface minecraftEcsStackProps extends StackProps {
  clusterName: string,
  serviceName: string,
  minecraftImage: string,
  watchdogImage: string
}

export class MinecraftEcsStack extends Stack {
  constructor(scope: Construct, id: string, props?: minecraftEcsStackProps) {
    super(scope, id, props);
    const {clusterName,serviceName,minecraftImage,watchdogImage} = props

    const vpc = new Vpc(this, "minecraftVPC", {
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 28,
          name: "AZ1",
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 28,
          name: "AZ2",
          subnetType: SubnetType.PUBLIC,
        },
      ],
    });

    const fs = new FileSystem(this, "minecraftFS", {
      vpc,
    });

    const accessPoint = fs.addAccessPoint("AccessPoint", {
      path: "/minecraft",
      posixUser: {
        uid: "1000",
        gid: "1000",
      },
      createAcl: {
        ownerGid: "1000",
        ownerUid: "1000",
        permissions: "0755",
      },
    });

    const cluster = new Cluster(this, "minecraftCluster", {
      clusterName: clusterName,
      vpc,
      enableFargateCapacityProviders: true,
    });

    const efsReadWritePermission = new iam.Policy(this, "fsRW", {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [...ACTIONS.ReadWriteDataFs],
          resources: [fs.fileSystemArn],
          conditions: {
            StringEquals: {
              "elasticfilesystem:AccessPointArn": accessPoint.accessPointArn,
            },
          },
        }),
      ],
    });

    const taskRole = new iam.Role(this, "EcsTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Minecraft ECS task role",
    });

    efsReadWritePermission.attachToRole(taskRole);

    const taskDefinition = new FargateTaskDefinition(
      this,
      "TaskDefinition",
      {
        taskRole: taskRole,
        memoryLimitMiB: 2048,
        cpu: 1024,
        volumes: [
          {
            name: "data",
            efsVolumeConfiguration: {
              fileSystemId: fs.fileSystemId,
              transitEncryption: "ENABLED",
              authorizationConfig: {
                accessPointId: accessPoint.accessPointId,
                iam: "ENABLED",
              },
            },
          },
        ],
      }
    );

    const minecraftServerContainer = taskDefinition.addContainer(
      "minecraftContainer",
      {
        containerName: "Minecraft",
        image: ContainerImage.fromRegistry(minecraftImage),
        portMappings: [
          { 
            containerPort: 25565,
            hostPort: 25565,
            protocol: Protocol.TCP,
          },
        ],
        environment: { EULA: "TRUE" },
      }
    );
    minecraftServerContainer.addMountPoints({
      containerPath: "/data",
      sourceVolume: "data",
      readOnly: false,
    });

    

    const serviceSG = new SecurityGroup(this, "ServiceSecurityGroup", {
      vpc,
      description: "Security group for task defintion",
    });

    serviceSG.addIngressRule(Peer.anyIpv4(), Port.tcp(25565));

    const minecraftServerService = new FargateService(
      this,
      "FargateService",
      {
        cluster,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE_SPOT",
            weight: 1,
            base: 1,
          },
        ],
        taskDefinition: taskDefinition,
        platformVersion: FargatePlatformVersion.LATEST,
        serviceName: "minecraftService",
        desiredCount: 0,
        assignPublicIp: true,
        securityGroups: [serviceSG],
      }
    );

    fs.connections.allowDefaultPortFrom(minecraftServerService.connections);

    const serviceControlPolicy = new iam.Policy(this, 'ServiceControlPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowAllOnServiceAndTask',
          effect: iam.Effect.ALLOW,
          actions: [...ACTIONS.AllowAllOnServiceAndTask],
          resources: [
            minecraftServerService.serviceArn,
            Arn.format(
              {
                service: 'ecs',
                resource: 'task',
                resourceName: `${clusterName}/*`,
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              },
              this
            ),
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [...ACTIONS.AllowGetIP],
          resources: ['*'],
        }),
      ],
    });

  
  }
}
