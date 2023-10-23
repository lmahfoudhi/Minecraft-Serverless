import { Stack, StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";

import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { HostedZone, ARecord, NsRecord } from "aws-cdk-lib/aws-route53";
import { Effect, ServicePrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";


import { ACTIONS } from "./utils";

export interface dnsTriggerStackProps extends StackProps {
  domain: string,
  subdomain: string,
  hostedZoneIdKey: string,
  lambdaArnKey: string,
}

export class DnsTriggerStack extends Stack {
  constructor(scope: Construct, id: string, props?: dnsTriggerStackProps) {
    super(scope, id, props);

    const { domain, subdomain, hostedZoneIdKey, lambdaArnKey } = props;

    const queryLogGroup = new LogGroup(this, "LogGroup", {
      logGroupName: `/aws/route53/${subdomain}`,
      retention: RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    queryLogGroup.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("route53.amazonaws.com")],
        actions: [...ACTIONS.R53LogsToCloudWatch],
      })
    );

    const rootHostedZone = HostedZone.fromLookup(this, "HostedZone", {
      domainName: domain,
    });

    const subdomainHostedZone = new HostedZone(this, "SubdomainHostedZone", {
      zoneName: subdomain,
      queryLogsLogGroupArn: queryLogGroup.logGroupArn,
    });

    new StringParameter(this, 'HostedZoneParam', {
      allowedPattern: '.*',
      description: 'Hosted zone ID for minecraft server',
      parameterName: hostedZoneIdKey ,
      stringValue: subdomainHostedZone.hostedZoneId,
    });

    const nsRecord = new NsRecord(this, "NSRecord", {
      zone: rootHostedZone,
      values: subdomainHostedZone.hostedZoneNameServers as string[],
      recordName: subdomain,
    });

    const aRecord = new ARecord(this, "ARecord", {
      target: {
        values: ["1.1.1.1"],
      },
      ttl: Duration.seconds(30),
      recordName: subdomain,
      zone: subdomainHostedZone,
    });
  }
}
