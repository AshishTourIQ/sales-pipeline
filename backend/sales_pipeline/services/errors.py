class ServiceError(Exception):
    """A business-rule failure the API returns as 400 {"detail", "code"}."""

    def __init__(self, detail: str, code: str = "invalid", status: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.status = status
