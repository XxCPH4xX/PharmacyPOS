import uuid


class CorrelationMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.correlation_id = str(uuid.uuid4())
        response = self.get_response(request)
        response["X-Request-ID"] = request.correlation_id
        if request.path.startswith("/api/"):
            response["Cache-Control"] = "no-store"
        return response
