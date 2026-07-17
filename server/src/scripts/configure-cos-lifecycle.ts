import "dotenv/config";
import COS from "cos-nodejs-sdk-v5";

const MANAGED_RULE_IDS = new Set([
  "quzijie-question-imports-30d",
  "quzijie-question-media-uploads-30d",
  "quzijie-question-bank-abort-multipart-7d"
]);

const managedRules: COS.LifecycleRule[] = [
  {
    ID: "quzijie-question-imports-30d",
    Status: "Enabled",
    Filter: { Prefix: "question-bank/imports/" },
    Expiration: { Days: 30 }
  },
  {
    ID: "quzijie-question-media-uploads-30d",
    Status: "Enabled",
    Filter: { Prefix: "question-bank/media/uploads/" },
    Expiration: { Days: 30 }
  },
  {
    ID: "quzijie-question-bank-abort-multipart-7d",
    Status: "Enabled",
    Filter: { Prefix: "question-bank/" },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }
  }
];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const bucket = required("COS_BUCKET");
  const region = required("COS_REGION");
  if (!apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      bucket,
      region,
      managedRules,
      preservedPrefixes: ["question-bank/releases/", "question-bank/media/sha256/"],
      applyCommand: "npm run storage:lifecycle --workspace server -- --apply"
    }, null, 2));
    return;
  }

  const cos = new COS({ SecretId: required("COS_SECRET_ID"), SecretKey: required("COS_SECRET_KEY") });
  let existing: COS.LifecycleRule[] = [];
  try {
    existing = (await cos.getBucketLifecycle({ Bucket: bucket, Region: region })).Rules || [];
  } catch (error) {
    const status = (error as { statusCode?: number; code?: string }).statusCode;
    const code = (error as { statusCode?: number; code?: string }).code;
    if (status !== 404 && code !== "NoSuchLifecycleConfiguration") throw error;
  }
  const preserved = existing.filter((rule) => !MANAGED_RULE_IDS.has(rule.ID));
  await cos.putBucketLifecycle({ Bucket: bucket, Region: region, Rules: [...preserved, ...managedRules] });
  console.log(JSON.stringify({
    applied: true,
    bucket,
    region,
    preservedRuleCount: preserved.length,
    managedRuleIds: Array.from(MANAGED_RULE_IDS)
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
