import { Stack, StackProps, Arn, ArnFormat } from "aws-cdk-lib";
import { Construct } from "constructs";

import {
  Vpc,
  SubnetType,
  SecurityGroup,
  Peer,
  Port,
} from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  FargateTaskDefinition,
  ContainerImage,
  Protocol,
  FargateService,
  FargatePlatformVersion,
} from "aws-cdk-lib/aws-ecs";
import { FileSystem } from "aws-cdk-lib/aws-efs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import * as iam from "aws-cdk-lib/aws-iam";

import { ACTIONS } from "./utils";
import { SSMParameterReader } from "./ssm-parameter-reader";

export interface minecraftEcsStackProps extends StackProps {
  clusterName: string;
  serviceName: string;
  minecraftImage: string;
  watchdogImage: string;
  hostedZoneIdKey: string;
  domain: string;
  subdomain: string;
}

export class MinecraftEcsStack extends Stack {
  constructor(scope: Construct, id: string, props?: minecraftEcsStackProps) {
    super(scope, id, props);
    const {
      clusterName,
      serviceName,
      minecraftImage,
      watchdogImage,
      hostedZoneIdKey,
      domain,
      subdomain,
    } = props;

/*
   VPC
*/

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

    /*
    EFS
*/
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

    /*
    ECS Cluster
*/
    const cluster = new Cluster(this, "minecraftCluster", {
      clusterName: clusterName,
      vpc,
      enableFargateCapacityProviders: true,
    });

    const taskRole = new iam.Role(this, "EcsTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Minecraft ECS task role",
    });

    const taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
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
    });

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

    const hostedZoneId = new SSMParameterReader(
      this,
      "Route53HostedZoneIdReader",
      {
        parameterName: hostedZoneIdKey,
        region: "us-east-1",
      }
    ).getParameterValue();

    const watchdogContainer = taskDefinition.addContainer("watchdogContainer", {
      containerName: "Watchdog",
      image: ContainerImage.fromRegistry(watchdogImage),
      portMappings: [
        {
          containerPort: 25565,
          hostPort: 25565,
          protocol: Protocol.TCP,
        },
      ],
      environment: {
        CLUSTER: clusterName,
        SERVICE: serviceName,
        DNSZONE: hostedZoneId,
        SERVERNAME: `${subdomain}.${domain}`,
      },
      essential: true,
    });

    const serviceSG = new SecurityGroup(this, "ServiceSecurityGroup", {
      vpc,
      description: "Security group for task defintion",
    });

    serviceSG.addIngressRule(Peer.anyIpv4(), Port.tcp(25565));

    const minecraftServerService = new FargateService(this, "FargateService", {
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
      serviceName: serviceName,
      desiredCount: 0,
      assignPublicIp: true,
      securityGroups: [serviceSG],
    });

    fs.connections.allowDefaultPortFrom(minecraftServerService.connections);

/*
    task role policies
*/

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

    efsReadWritePermission.attachToRole(taskRole);

    const serviceControlPolicy = new iam.Policy(this, "ServiceControlPolicy", {
      statements: [
        new iam.PolicyStatement({
          sid: "AllowAllOnServiceAndTask",
          effect: iam.Effect.ALLOW,
          actions: [...ACTIONS.AllowAllOnServiceAndTask],
          resources: [
            minecraftServerService.serviceArn,
            Arn.format(
              {
                service: "ecs",
                resource: "task",
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
          resources: ["*"],
        }),
      ],
    });

    serviceControlPolicy.attachToRole(taskRole);


    const iamRoute53Policy = new iam.Policy(this, 'IamRoute53Policy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowEditRecordSets',
          effect: iam.Effect.ALLOW,
          actions: [
            ...ACTIONS.AllowModifyHostedZone
          ],
          resources: [`arn:aws:route53:::hostedzone/${hostedZoneId}`],
        }),
      ],
    });

    iamRoute53Policy.attachToRole(taskRole);

  }
}



