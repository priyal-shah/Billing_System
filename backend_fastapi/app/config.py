from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"  # "production" enables startup safety checks
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "grocery_billing"
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720
    guest_expire_minutes: int = 240
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    rate_limit_enabled: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

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
