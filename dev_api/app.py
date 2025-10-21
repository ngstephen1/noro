from dotenv import load_dotenv; load_dotenv()
import os, json
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# local env defaults (override via exported env vars)
os.environ.setdefault("DDB_TABLE", "pia-dev")
os.environ.setdefault("DDB_ENDPOINT_URL", "http://localhost:8000")
os.environ.setdefault("AWS_REGION", "us-east-1")

# reuse your lambda handlers
from backend.process_context.app import handler as process_handler
from backend.get_insights.app import handler as insights_handler

app = FastAPI(title="PIA Local API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/context")
async def post_context(req: Request):
    payload = await req.json()
    event = {"Records": [{"body": json.dumps(payload)}]}  # mimic SQS event
    result = process_handler(event, None)
    return JSONResponse({"ok": True, "processed": result.get("processed", 1)})

@app.get("/insights")
async def get_insights(user_id: str, limit: int = 5):
    event = {"httpMethod":"GET","queryStringParameters":{"user_id":user_id,"limit":str(limit)}}
    resp = insights_handler(event, None)
    return JSONResponse(status_code=resp["statusCode"], content=json.loads(resp["body"]))


@app.get("/_debug/env")
def debug_env():
    import os, boto3
    idn = boto3.client("sts").get_caller_identity()
    tables = boto3.client("dynamodb", region_name=os.getenv("AWS_REGION","us-east-1")).list_tables().get("TableNames", [])
    return {
        "env": {
            "AWS_PROFILE": os.getenv("AWS_PROFILE"),
            "AWS_REGION": os.getenv("AWS_REGION"),
            "DDB_TABLE": os.getenv("DDB_TABLE"),
            "DDB_ENDPOINT_URL": os.getenv("DDB_ENDPOINT_URL"),
        },
        "identity": idn,
        "tables": tables,
    }