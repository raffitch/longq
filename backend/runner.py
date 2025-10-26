from uvicorn import Config, Server

from app import app


def main() -> None:
    config = Config(app=app, host="0.0.0.0", port=8000, reload=False)
    server = Server(config)
    app.state.uvicorn_server = server
    server.run()


if __name__ == "__main__":
    main()
