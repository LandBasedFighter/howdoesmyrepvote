import os
import requests
import pg8000
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

url = urlparse(os.environ["CONNECTIONSTRING"])

with pg8000.connect(
    user=url.username,
    password=url.password,
    host=url.hostname,
    port=url.port or 5432,
    database=url.path.lstrip("/"),
    ssl_context=True,
) as conn:
    cur = conn.cursor()
    cur.execute("SELECT * FROM members")
    for row in cur.fetchall():
        print(row)
    cur.close()
    
key = os.environ["CONGRESS_CIVIC_API_KEY"]
resp = requests.get("https://api.congress.gov/v3/house-vote/119/1",
                    params={"api_key": key, "limit": 5})
print(resp.status_code)
print(resp.json())