import os
from functools import lru_cache
from typing import Any, cast

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import Client, create_client

load_dotenv()

# We use the Service Role Key in the backend to bypass RLS.
# This is necessary because the backend needs to perform administrative tasks
# like decrypting BYOK keys and orchestrating messages on behalf of the user.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

@lru_cache(maxsize=1)
def get_db() -> Client:
    # One client per process: reuses its HTTP connections instead of opening new
    # ones (and a new TLS handshake) for every query.
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("Supabase environment variables are missing.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Every table the backend or frontend reads. Keep in sync with schema.sql.
REQUIRED_TABLES = [
    "teams",
    "team_members",
    "projects",
    "threads",
    "messages",
    "user_api_keys",
    "team_invitations",
    "thread_reads",
    "ai_request_log",
]

# PostgREST: table not in schema cache / Postgres: undefined table.
MISSING_TABLE_CODES = {"PGRST205", "42P01"}


def find_missing_tables(db: Client) -> list[str]:
    """
    Return the required tables that don't exist. Any other error (bad key,
    network) is raised, so it isn't mistaken for missing tables.
    """
    missing = []
    for table in REQUIRED_TABLES:
        try:
            db.table(table).select("*").limit(0).execute()
        except APIError as exc:
            if exc.code in MISSING_TABLE_CODES:
                missing.append(table)
            else:
                raise
    return missing

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
