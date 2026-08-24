import os
import base64
from typing import Any, cast

from cryptography.fernet import Fernet

from backend.db import get_db


def _get_fernet() -> Fernet:
    """Build a Fernet instance from the 32-byte hex master key stored in env."""
    master_key_hex = os.getenv("MASTER_ENCRYPTION_KEY", "")
    if not master_key_hex:
        raise ValueError("MASTER_ENCRYPTION_KEY environment variable is not set.")
    # Fernet requires a 32-byte URL-safe base64-encoded key.
    # We store the master key as 64 hex chars (= 32 raw bytes) and convert here.
    raw_bytes = bytes.fromhex(master_key_hex)
    fernet_key = base64.urlsafe_b64encode(raw_bytes)
    return Fernet(fernet_key)


def encrypt_key(plain_key: str) -> str:
    """Encrypt a plain-text API key and return it as a string."""
    return _get_fernet().encrypt(plain_key.encode()).decode()


def decrypt_key(encrypted_key: str) -> str:
    """Decrypt a stored encrypted API key back to plain text."""
    return _get_fernet().decrypt(encrypted_key.encode()).decode()


def store_api_key(user_id: str, provider: str, plain_key: str) -> None:
    """Encrypt and upsert a user's provider API key into Supabase."""
    db = get_db()
    encrypted = encrypt_key(plain_key)
    db.table("user_api_keys").upsert(
        {
            "user_id": user_id,
            "provider": provider,
            "encrypted_key": encrypted,
        },
        on_conflict="user_id,provider",
    ).execute()


def get_api_key(user_id: str, provider: str) -> str | None:
    """Fetch and decrypt a user's API key for the given provider. Returns None if not found."""
    db = get_db()
    response = (
        db.table("user_api_keys")
        .select("encrypted_key")
        .eq("user_id", user_id)
        .eq("provider", provider)
        .execute()
    )
    data = cast(list[dict[str, Any]], response.data)
    if not data:
        return None
    return decrypt_key(data[0]["encrypted_key"])


def delete_api_key(user_id: str, provider: str) -> None:
    """Remove a stored API key for a given provider."""
    db = get_db()
    db.table("user_api_keys").delete().eq("user_id", user_id).eq("provider", provider).execute()


def list_saved_providers(user_id: str) -> list[str]:
    """Return the list of provider names for which the user has saved a key."""
    db = get_db()
    response = db.table("user_api_keys").select("provider").eq("user_id", user_id).execute()
    data = cast(list[dict[str, Any]], response.data)
    return [row["provider"] for row in data]
