import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface minecraftStackProps extends StackProps{

}

export class MinecraftStack extends Stack {
  constructor(scope: Construct, id: string, props:minecraftStackProps ) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this,"minecraftVPC",{
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

   
  }
}
