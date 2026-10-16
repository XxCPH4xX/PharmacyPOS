from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as drf_handler


class BusinessError(APIException):
    status_code = 409
    default_code = "conflict"

    def __init__(self, message, code="conflict", status=409):
        self.status_code = status
        super().__init__(detail=message, code=code)


def exception_handler(exc, context):
    response = drf_handler(exc, context)
    if response is not None:
        detail = response.data
        response.data = {
            "error": {
                "code": getattr(exc, "default_code", "invalid_request")
                if not isinstance(exc, BusinessError)
                else exc.detail.code,
                "message": str(detail.get("detail", "Please check the supplied fields."))
                if isinstance(detail, dict)
                else "Invalid request.",
                "fields": detail if isinstance(detail, dict) and "detail" not in detail else {},
                "request_id": getattr(context.get("request"), "correlation_id", None),
            }
        }
    return response
