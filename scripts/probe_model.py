"""Diagnose the configured provider using synthetic data; never prints its key."""
import base64
import json
import os
import urllib.error
import urllib.request
import cv2
import numpy as np
from server import config

key = os.getenv("QWEN_API_KEY", config.QWEN_API_KEY).strip()
print("Model credential present:", bool(key), "model:", config.QWEN_MODEL)
image = np.full((240, 480, 3), 255, dtype=np.uint8)
cv2.rectangle(image, (30, 70), (420, 160), (0, 0, 0), 3)
cv2.putText(image, "1. BUTTON: Next step", (50, 120), cv2.FONT_HERSHEY_SIMPLEX, .8, (0, 0, 0), 2)
_, encoded = cv2.imencode(".png", image)
payload = {"model": config.QWEN_MODEL, "messages": [{"role": "user", "content": [
    {"type": "text", "text": 'Read this synthetic control diagram. Return JSON: {"elements":[{"text":"label","bbox":[x1,y1,x2,y2]}]}'},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(encoded).decode()}},
]}], "temperature": .1}
request = urllib.request.Request(config.QWEN_BASE + "/chat/completions", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.load(response)
        print("PROVIDER_OK", response.status, "model:", result.get("model"))
        print("Synthetic result:", str(result.get("choices", [{}])[0].get("message", {}).get("content", ""))[:350].replace(key, "[redacted]"))
except urllib.error.HTTPError as error:
    body = error.read().decode(errors="replace")
    print("PROVIDER_HTTP_ERROR", error.code, body.replace(key, "[redacted]")[:350] if key else "No credential")
except Exception as error:
    print("PROVIDER_CONNECTION_ERROR", type(error).__name__)
