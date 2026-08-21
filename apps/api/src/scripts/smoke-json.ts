import { enableJsonBigIntSerialization } from "../common/json";

enableJsonBigIntSerialization();

const payload = JSON.stringify({ fileSize: 1234567890123456789n });
if (payload !== "{\"fileSize\":\"1234567890123456789\"}") {
  throw new Error(`Unexpected BigInt JSON payload: ${payload}`);
}

process.stdout.write("JSON BigInt serialization smoke passed\n");
