import { Stack, StackProps, Arn, ArnFormat, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";

import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { HostedZone, ARecord } from "aws-cdk-lib/aws-route53";
import { Effect, ServicePrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";

import { ACTIONS } from "./utils";

export interface dnsTriggerStackProps extends StackProps {}

export class DnsTriggerStack extends Stack {
  constructor(scope: Construct, id: string, props?: domainStackProps) {
    super(scope, id, props);
    const subdomain = `minecraft.server.com`;

    const queryLogGroup = new LogGroup(this, "LogGroup", {
      logGroupName: `/aws/route53/${subdomain}`,
      retention: RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    queryLogGroup.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("route53.amazonaws.com")],
        actions: ["logs:PutLogEvents"],
      })
    );

    const rootHostedZone = HostedZone.fromLookup(this, "HostedZone", {
      domainName: "server.com",
    });

    const subdomainHostedZone = new HostedZone(this, "SubdomainHostedZone", {
      zoneName: subdomain,
      queryLogsLogGroupArn: queryLogGroup.logGroupArn,
    });
  }
}
