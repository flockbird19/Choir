import os
from typing import Any, cast

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

# We use the Service Role Key in the backend to bypass RLS.
# This is necessary because the backend needs to perform administrative tasks
# like decrypting BYOK keys and orchestrating messages on behalf of the user.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

def get_db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("Supabase environment variables are missing.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def verify_thread_access(user_id: str, thread_id: str) -> bool:
    """
    Manually verify if a user has access to a thread.
    Returns True if access is allowed, False otherwise.
    """
    db = get_db()
    
    # Get the thread
    response = db.table("threads").select("*").eq("id", thread_id).execute()
    data = cast(list[dict[str, Any]], response.data)
    if not data:
        return False
        
    thread = data[0]
    
    if thread["type"] == "private":
        return thread["owner_id"] == user_id
        
    elif thread["type"] == "shared":
        # Check if the user is in the team that owns the project
        project_id = thread["project_id"]
        proj_response = db.table("projects").select("team_id").eq("id", project_id).execute()
        proj_data = cast(list[dict[str, Any]], proj_response.data)
        if not proj_data:
            return False
            
        team_id = proj_data[0]["team_id"]
        
        # Check team_members
        member_response = db.table("team_members").select("user_id").eq("team_id", team_id).eq("user_id", user_id).execute()
        member_data = cast(list[dict[str, Any]], member_response.data)
        return len(member_data) > 0
        
    return False

def verify_team_access(user_id: str, team_id: str) -> bool:
    """
    Manually verify if a user has access to a team.
    Returns True if access is allowed, False otherwise.
    """
    db = get_db()
    
    response = db.table("team_members").select("user_id").eq("team_id", team_id).eq("user_id", user_id).execute()
    data = cast(list[dict[str, Any]], response.data)
    return len(data) > 0
