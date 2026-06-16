BACKEND_ADDR ?= 127.0.0.1:8080
EMBEDDED_STATIC_DIR ?= backend/internal/staticfiles/app

.PHONY: help clean dev frontend package test test-backend test-frontend vendor-backend

help:
	@echo Available targets:
	@echo   clean          Remove generated frontend, embedded static, and package output directories
	@echo   dev            Run the Go backend server
	@echo   frontend       Run the Vite frontend dev server
	@echo   package        Embed the frontend, test the backend, and create dist/jena-backend.exe
	@echo   test           Run frontend and backend tests
	@echo   test-backend   Run backend Go tests
	@echo   test-frontend  Run frontend Vitest tests
	@echo   vendor-backend Tidy Go modules and rebuild backend/vendor

clean:
	powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Recurse -Force frontend/dist, backend/static, dist -ErrorAction SilentlyContinue"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '$(EMBEDDED_STATIC_DIR)') { Get-ChildItem -LiteralPath '$(EMBEDDED_STATIC_DIR)' -Force | Where-Object { $$_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force }"

dev:
	cd backend && go run -mod=vendor ./cmd/jena-backend -addr $(BACKEND_ADDR)

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
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force '$(EMBEDDED_STATIC_DIR)' | Out-Null; Get-ChildItem -LiteralPath '$(EMBEDDED_STATIC_DIR)' -Force | Where-Object { $$_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force; Copy-Item -Recurse frontend/dist/* '$(EMBEDDED_STATIC_DIR)'"
	cd backend && go test -mod=vendor ./...
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force dist | Out-Null"
	cd backend && go build -mod=vendor -buildvcs=false -o ../dist/jena-backend.exe ./cmd/jena-backend
