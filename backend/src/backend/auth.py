import os
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from backend.db import get_db

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    """
    Dependency to verify the Supabase JWT.
    Calls the Supabase Auth server to securely validate the token and get the user.
    Returns the user_id if valid, otherwise raises a 401 error.
    """
    token = credentials.credentials
    
    db = get_db()
    try:
        user_response = db.auth.get_user(token)
        if not user_response or not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid token payload.")
        return user_response.user.id
        
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid authentication token: {str(e)}")
