export const ACTIONS = {
  R53LogsToCloudWatch: ["logs:PutLogEvents", "logs:CreateLogStream"],

  ReadWriteDataFs: [
    "elasticfilesystem:ClientMount",
    "elasticfilesystem:ClientWrite",
    "elasticfilesystem:DescribeFileSystems",
  ],

  AllowAllOnServiceAndTask: ["ecs*"],

  AllowGetIP: ["ec2:DescribeNetworkInterfaces"],
  
  AllowModifyHostedZone: [
    "route53:GetHostedZone",
    "route53:ChangeResourceRecordSets",
    "route53:ListResourceRecordSets",
  ],
};
