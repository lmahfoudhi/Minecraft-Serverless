import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';

import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as efs from 'aws-cdk-lib/aws-efs'
import * as iam from 'aws-cdk-lib/aws-iam'

import { Construct } from 'constructs';

export interface minecraftStackProps extends StackProps {

}

export class MinecraftStack extends Stack {
  constructor(scope: Construct, id: string, props: minecraftStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "minecraftVPC", {
      vpcName: "Minecraft-VPC",
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 28,
          name: 'AZ1',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 28,
          name: 'AZ2',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ]
    })

    const fs = new efs.FileSystem(this, 'minecraftFS', {
      vpc,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    const accessPoint = fs.addAccessPoint("AccessPoint",{
      path: '/minecraft',
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '0755',
      },
    })

    




  }
}
