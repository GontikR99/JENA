BACKEND_ADDR ?= 127.0.0.1:8080
BACKEND_STATIC_DIR ?= static

.PHONY: clean dev frontend package test test-backend test-frontend vendor-backend

clean:
	powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Recurse -Force frontend/dist, backend/static, dist -ErrorAction SilentlyContinue"

dev:
	cd backend && go run -mod=vendor ./cmd/jena-backend -addr $(BACKEND_ADDR) -static-dir $(BACKEND_STATIC_DIR)

frontend:
	cd frontend && npm run dev

test: test-frontend test-backend

test-frontend:
	cd frontend && npm run test

test-backend:
	cd backend && go test -mod=vendor ./...

vendor-backend:
	cd backend && go mod tidy
	powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Recurse -Force backend/vendor -ErrorAction SilentlyContinue"
	cd backend && go mod vendor

package:
	cd frontend && npm run build
	powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Recurse -Force backend/static -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force backend/static | Out-Null; Copy-Item -Recurse frontend/dist/* backend/static/"
	cd backend && go test -mod=vendor ./...
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force dist | Out-Null"
	cd backend && go build -mod=vendor -buildvcs=false -o ../dist/jena-backend.exe ./cmd/jena-backend
