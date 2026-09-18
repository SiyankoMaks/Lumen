from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./lumen.db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = ""
    ai_providers: str = "polza,yandex,openrouter"
    polza_api_key: str = ""
    polza_model: str = ""
    yandex_api_key: str = ""
    yandex_model: str = ""
    openrouter_api_key: str = ""
    openrouter_model: str = ""


settings = Settings()
