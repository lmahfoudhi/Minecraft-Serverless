import { Stack, StackProps, RemovalPolicy,  Arn,ArnFormat } from "aws-cdk-lib";
import { Construct } from "constructs";

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecs from "aws-cdk-lib/aws-ecs";

import { ACTIONS } from "./utils";

export interface minecraftStackProps extends StackProps {}

export class MinecraftStack extends Stack {
  constructor(scope: Construct, id: string, props?: minecraftStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "minecraftVPC", {
      vpcName: "Minecraft-VPC",
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 28,
          name: "AZ1",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 28,
          name: "AZ2",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const fs = new efs.FileSystem(this, "minecraftFS", {
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

    const cluster = new ecs.Cluster(this, "minecraftCluster", {
      clusterName: "Minecraft",
      vpc,
      enableFargateCapacityProviders: true,
    });

    const efsReadWritePermission = new iam.Policy(this, "fsRW", {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [...ACTIONS.ReadWriteData],
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

    const taskDefinition = new ecs.FargateTaskDefinition(
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
        image: ecs.ContainerImage.fromRegistry("itzg/minecraft-server"),
        portMappings: [
          { 
            containerPort: 25565,
            hostPort: 25565,
            protocol: ecs.Protocol.TCP,
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

    const serviceSG = new ec2.SecurityGroup(this, "ServiceSecurityGroup", {
      vpc,
      description: "Security group for task defintion",
    });

    serviceSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(25565));

    const minecraftServerService = new ecs.FargateService(
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
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        serviceName: "minecraftService",
        desiredCount: 1,
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
          actions: ['ecs:*'],
          resources: [
            minecraftServerService.serviceArn,
            /* arn:aws:ecs:<region>:<account_number>:task/minecraft/* */
            Arn.format(
              {
                service: 'ecs',
                resource: 'task',
                resourceName: `Minecraft/*`,
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              },
              this
            ),
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ec2:DescribeNetworkInterfaces'],
          resources: ['*'],
        }),
      ],
    });

    serviceControlPolicy.attachToRole(taskRole);
  }
}
