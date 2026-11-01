from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"  # "production" enables startup safety checks
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "grocery_billing"
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    # Signed-in sessions: a short-lived access cookie, renewed with a rotating refresh cookie.
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    guest_expire_minutes: int = 240
    # Secure (HTTPS-only) cookies. Defaults to on in production; local http://localhost needs it off.
    cookie_secure: bool | None = None
    # Admins must set up two-factor sign-in (authenticator app) before using the admin pages.
    require_admin_2fa: bool = True
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    rate_limit_enabled: bool = True
    # AI assistant for admins. Leave the key empty to switch the feature off.
    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-5-5"
    ai_timezone: str = "Asia/Kolkata"  # how dates in admin questions ("today", "last week") are read

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def secure_cookies(self) -> bool:
        return self.is_production if self.cookie_secure is None else self.cookie_secure

    @property
    def ai_enabled(self) -> bool:
        return bool(self.anthropic_api_key.strip())

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    def check_production_ready(self) -> None:
        """Refuse to start a public deployment with unsafe defaults."""
        problems = []
        if self.jwt_secret == DEFAULT_JWT_SECRET or len(self.jwt_secret) < 32:
            problems.append("JWT_SECRET must be set to a random string of at least 32 characters")
        if self.mongo_uri.startswith("mongodb://localhost"):
            problems.append("MONGO_URI still points at localhost")
        if problems:
            raise RuntimeError("Production configuration error: " + "; ".join(problems))


def get_settings() -> Settings:
    return Settings()
