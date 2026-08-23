from typing import Any, cast

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.auth import get_current_user
from backend.db import get_db

app = FastAPI(title="Choir AI Backend")

# Allow Next.js frontend to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Choir Python Backend is running!"}

@app.get("/api/me")
def get_my_info(user_id: str = Depends(get_current_user)):
    """
    Test endpoint to verify authentication works.
    Returns the user's ID and fetches their teams from the database
    bypassing RLS (since we are using the service role key).
    """
    db = get_db()
    # Example: fetch the user's teams directly bypassing RLS
    response = db.table("team_members").select("team_id").eq("user_id", user_id).execute()
    data = cast(list[dict[str, Any]], response.data)
    team_ids = [row["team_id"] for row in data] if data else []
    
    return {
        "user_id": user_id,
        "team_ids": team_ids,
        "message": "Authentication successful!"
    }
