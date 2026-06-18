BACKEND_ADDR ?= 127.0.0.1:8080
BACKEND_VENDOR_DIR ?= backend/vendor
EMBEDDED_STATIC_DIR ?= backend/internal/staticfiles/app
FRONTEND_NODE_MODULES_DIR ?= frontend/node_modules

.PHONY: help clean dev dist-clean frontend init package package-linux-x86_64 test test-backend test-frontend vendor-backend

help:
	@echo Available targets:
	@echo   clean          Remove generated frontend, embedded static, and package output directories
	@echo   dev            Run the Go backend server
	@echo   dist-clean     Run clean and remove frontend node_modules and backend vendor
	@echo   frontend       Run the Vite frontend dev server
	@echo   init           Install frontend node_modules and rebuild backend vendor
	@echo   package        Embed the frontend, test the backend, and create dist/jena-backend.exe
	@echo   package-linux-x86_64 Embed the frontend, test the backend, and create dist/jena-backend-linux-x86_64
	@echo   test           Run frontend and backend tests
	@echo   test-backend   Run backend Go tests
	@echo   test-frontend  Run frontend Vitest tests
	@echo   vendor-backend Tidy Go modules and rebuild backend/vendor

clean:
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$$paths = @('frontend/dist', 'backend/static', 'dist'); foreach ($$path in $$paths) { if (Test-Path -LiteralPath $$path) { Remove-Item -LiteralPath $$path -Recurse -Force } }"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '$(EMBEDDED_STATIC_DIR)') { Get-ChildItem -LiteralPath '$(EMBEDDED_STATIC_DIR)' -Force | Where-Object { $$_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force }"

dist-clean: clean
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$$paths = @('$(FRONTEND_NODE_MODULES_DIR)', '$(BACKEND_VENDOR_DIR)'); foreach ($$path in $$paths) { if (Test-Path -LiteralPath $$path) { Remove-Item -LiteralPath $$path -Recurse -Force } }"

dev:
	cd backend && go run -mod=vendor ./cmd/jena-backend -addr $(BACKEND_ADDR)

frontend:
	cd frontend && npm run dev

init:
	cd frontend && npm ci
	$(MAKE) vendor-backend

test: test-frontend test-backend

test-frontend:
	cd frontend && npm run test

test-backend:
	cd backend && go test -mod=vendor ./...

vendor-backend:
	cd backend && go mod tidy
	powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path -LiteralPath '$(BACKEND_VENDOR_DIR)') { Remove-Item -LiteralPath '$(BACKEND_VENDOR_DIR)' -Recurse -Force }"
	cd backend && go mod vendor

package:
	cd frontend && npm run build
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force '$(EMBEDDED_STATIC_DIR)' | Out-Null; Get-ChildItem -LiteralPath '$(EMBEDDED_STATIC_DIR)' -Force | Where-Object { $$_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force; Copy-Item -Recurse frontend/dist/* '$(EMBEDDED_STATIC_DIR)'"
	cd backend && go test -mod=vendor ./...
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force dist | Out-Null"
	cd backend && go build -mod=vendor -buildvcs=false -o ../dist/jena-backend.exe ./cmd/jena-backend

package-linux-x86_64:
	cd frontend && npm run build
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force '$(EMBEDDED_STATIC_DIR)' | Out-Null; Get-ChildItem -LiteralPath '$(EMBEDDED_STATIC_DIR)' -Force | Where-Object { $$_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force; Copy-Item -Recurse frontend/dist/* '$(EMBEDDED_STATIC_DIR)'"
	cd backend && go test -mod=vendor ./...
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force dist | Out-Null"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$$env:GOOS = 'linux'; $$env:GOARCH = 'amd64'; $$env:CGO_ENABLED = '0'; Push-Location backend; try { go build -mod=vendor -buildvcs=false -o ../dist/jena-backend-linux-x86_64 ./cmd/jena-backend } finally { Pop-Location }"
