import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  PutMetricAlarmCommand,
} from "@aws-sdk/client-cloudwatch";

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = "681837897606";
const TOPIC_ARN = `arn:aws:sns:${REGION}:${ACCOUNT_ID}:oms-dashboard-critical`;
const LEARNING_TABLE = process.env.DYNAMODB_DASHBOARD_TABLE || "OpenMatrixLearning";
const AUDIT_TABLE = process.env.DYNAMODB_DASHBOARD_AUDIT_TABLE || "OpenMatrixAudit";
const SKILLS_INDEX = process.env.DYNAMODB_DASHBOARD_SKILLS_INDEX || "GSI2";
const commit = process.argv.includes("--commit");

function alarm(AlarmName, MetricName, Dimensions) {
  return {
    AlarmName,
    AlarmDescription: `OpenMatrix Dashboard Phase 02: ${MetricName}`,
    ActionsEnabled: true,
    AlarmActions: [TOPIC_ARN],
    OKActions: [],
    InsufficientDataActions: [],
    Namespace: "AWS/DynamoDB",
    MetricName,
    Dimensions,
    Statistic: "Sum",
    Period: 60,
    EvaluationPeriods: 1,
    DatapointsToAlarm: 1,
    Threshold: 1,
    ComparisonOperator: "GreaterThanOrEqualToThreshold",
    TreatMissingData: "notBreaching",
    Unit: "Count",
    Tags: [
      { Key: "Application", Value: "OpenMatrixDashboard" },
      { Key: "Phase", Value: "02" },
      { Key: "ManagedBy", Value: "configure-dashboard-cloudwatch-alarms" },
    ],
  };
}

const table = (name) => [{ Name: "TableName", Value: name }];
const tableOperation = (name, operation) => [
  { Name: "TableName", Value: name },
  { Name: "Operation", Value: operation },
];

const alarms = [
  alarm("OMS-P2-Learning-ReadThrottle", "ReadThrottleEvents", table(LEARNING_TABLE)),
  alarm("OMS-P2-Learning-GSI2-ReadThrottle", "ReadThrottleEvents", [
    { Name: "TableName", Value: LEARNING_TABLE },
    { Name: "GlobalSecondaryIndexName", Value: SKILLS_INDEX },
  ]),
  alarm("OMS-P2-Learning-WriteThrottle", "WriteThrottleEvents", table(LEARNING_TABLE)),
  alarm("OMS-P2-Audit-ReadThrottle", "ReadThrottleEvents", table(AUDIT_TABLE)),
  alarm("OMS-P2-Audit-WriteThrottle", "WriteThrottleEvents", table(AUDIT_TABLE)),
  ...["GetItem", "Query", "PutItem", "UpdateItem", "TransactWriteItems"].map((operation) =>
    alarm(`OMS-P2-Learning-SystemErrors-${operation}`, "SystemErrors", tableOperation(LEARNING_TABLE, operation))),
  ...["Query", "TransactWriteItems"].map((operation) =>
    alarm(`OMS-P2-Audit-SystemErrors-${operation}`, "SystemErrors", tableOperation(AUDIT_TABLE, operation))),
];

console.log(JSON.stringify({
  mode: commit ? "commit" : "dry-run",
  region: REGION,
  topicArn: TOPIC_ARN,
  alarmCount: alarms.length,
  alarms: alarms.map(({ AlarmName, MetricName, Dimensions }) => ({ AlarmName, MetricName, Dimensions })),
}, null, 2));

if (!commit) {
  console.log("Dry-run only. Re-run with --commit to create or update these alarms.");
  process.exit(0);
}

const client = new CloudWatchClient({ region: REGION });
for (const definition of alarms) {
  await client.send(new PutMetricAlarmCommand(definition));
  console.log(`PUT ${definition.AlarmName}`);
}

const result = await client.send(new DescribeAlarmsCommand({
  AlarmNamePrefix: "OMS-P2-",
  AlarmTypes: ["MetricAlarm"],
}));
const expected = new Set(alarms.map(({ AlarmName }) => AlarmName));
const actual = (result.MetricAlarms || []).filter(({ AlarmName }) => expected.has(AlarmName));
console.log(JSON.stringify({
  verification: actual.length === alarms.length ? "PASS" : "FAIL",
  expected: alarms.length,
  found: actual.length,
  states: actual.map(({ AlarmName, StateValue }) => ({ AlarmName, StateValue })),
}, null, 2));
if (actual.length !== alarms.length) process.exitCode = 1;
