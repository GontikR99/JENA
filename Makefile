BACKEND_ADDR ?= 127.0.0.1:8080
BACKEND_VENDOR_DIR ?= backend/vendor
EMBEDDED_STATIC_DIR ?= backend/internal/staticfiles/app
FRONTEND_NODE_MODULES_DIR ?= frontend/node_modules
PROTOCOL_VERSION_FILE ?= protocol-version.txt

-include deploy.local.mk

DEPLOY_BINARY ?= dist/jena-backend-linux-x86_64
DEPLOY_ENV ?= test
DEPLOY_ID ?= $(shell powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd-HHmmss'")
DEPLOY_REMOTE_BINARY ?= /tmp/jena-backend
DEPLOY_SCP ?= scp
DEPLOY_SSH ?= ssh

.PHONY: check-deploy-config help bump-protocol-version clean clean-go-cache deploy dev dist-clean frontend generate-protocol-version init package package-linux-x86_64 promote test test-backend test-frontend vendor-backend

help:
	@echo Available targets:
	@echo   bump-protocol-version Increment the frontend/backend protocol compatibility version
	@echo   clean          Remove generated frontend, embedded static, package output directories, and Go build cache
	@echo   deploy         Build Linux binary, copy it to the configured deploy host, and run deploy-jena
	@echo   dev            Run the Go backend server
	@echo   dist-clean     Run clean and remove frontend node_modules and backend vendor
	@echo   frontend       Run the Vite frontend dev server
	@echo   generate-protocol-version Regenerate frontend/backend protocol version source files
	@echo   init           Install frontend node_modules and rebuild backend vendor
	@echo   package        Embed the frontend, test the backend, and create dist/jena-backend.exe
	@echo   package-linux-x86_64 Embed the frontend, test the backend, and create dist/jena-backend-linux-x86_64
	@echo   promote        Promote the configured test deployment to live
	@echo   test           Run frontend and backend tests
	@echo   test-backend   Run backend Go tests
	@echo   test-frontend  Run frontend Vitest tests
	@echo   vendor-backend Tidy Go modules and rebuild backend/vendor

check-deploy-config:
	powershell -NoProfile -ExecutionPolicy Bypass -Command "if ('$(DEPLOY_USER)' -eq '' -or '$(DEPLOY_HOST)' -eq '') { throw 'Set DEPLOY_USER and DEPLOY_HOST in deploy.local.mk or on the make command line. See deploy.example.mk.' }"

bump-protocol-version:
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-protocol-version.ps1 -ProtocolVersionFile '$(PROTOCOL_VERSION_FILE)' -Bump

generate-protocol-version:
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-protocol-version.ps1 -ProtocolVersionFile '$(PROTOCOL_VERSION_FILE)'

clean: clean-go-cache
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$$paths = @('frontend/dist', 'backend/static', 'dist'); foreach ($$path in $$paths) { if (Test-Path -LiteralPath $$path) { Remove-Item -LiteralPath $$path -Recurse -Force } }"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '$(EMBEDDED_STATIC_DIR)') { Get-ChildItem -LiteralPath '$(EMBEDDED_STATIC_DIR)' -Force | Where-Object { $$_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force }"

clean-go-cache:
	cd backend && go clean -cache

dist-clean: clean
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$$paths = @('$(FRONTEND_NODE_MODULES_DIR)', '$(BACKEND_VENDOR_DIR)'); foreach ($$path in $$paths) { if (Test-Path -LiteralPath $$path) { Remove-Item -LiteralPath $$path -Recurse -Force } }"

dev: generate-protocol-version
	cd backend && go run -mod=vendor ./cmd/jena-backend -addr $(BACKEND_ADDR)

frontend: generate-protocol-version
	cd frontend && npm run dev

init:
	cd frontend && npm ci
	$(MAKE) vendor-backend

test: generate-protocol-version test-frontend test-backend

test-frontend: generate-protocol-version
	cd frontend && npm run test

test-backend: generate-protocol-version
	cd backend && go test -mod=vendor ./...

vendor-backend:
	cd backend && go mod tidy
	powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path -LiteralPath '$(BACKEND_VENDOR_DIR)') { Remove-Item -LiteralPath '$(BACKEND_VENDOR_DIR)' -Recurse -Force }"
	cd backend && go mod vendor

package: generate-protocol-version clean-go-cache
	cd frontend && npm run build
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force '$(EMBEDDED_STATIC_DIR)' | Out-Null; Get-ChildItem -LiteralPath '$(EMBEDDED_STATIC_DIR)' -Force | Where-Object { $$_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force; Copy-Item -Recurse frontend/dist/* '$(EMBEDDED_STATIC_DIR)'"
	cd backend && go test -mod=vendor ./...
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force dist | Out-Null"
	cd backend && go build -mod=vendor -buildvcs=false -o ../dist/jena-backend.exe ./cmd/jena-backend

package-linux-x86_64: generate-protocol-version clean-go-cache
	cd frontend && npm run build
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force '$(EMBEDDED_STATIC_DIR)' | Out-Null; Get-ChildItem -LiteralPath '$(EMBEDDED_STATIC_DIR)' -Force | Where-Object { $$_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force; Copy-Item -Recurse frontend/dist/* '$(EMBEDDED_STATIC_DIR)'"
	cd backend && go test -mod=vendor ./...
	powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force dist | Out-Null"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$$env:GOOS = 'linux'; $$env:GOARCH = 'amd64'; $$env:CGO_ENABLED = '0'; Push-Location backend; try { go build -mod=vendor -buildvcs=false -o ../dist/jena-backend-linux-x86_64 ./cmd/jena-backend } finally { Pop-Location }"

deploy: check-deploy-config package-linux-x86_64
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-jena.ps1 -Binary '$(DEPLOY_BINARY)' -User '$(DEPLOY_USER)' -HostName '$(DEPLOY_HOST)' -RemoteBinary '$(DEPLOY_REMOTE_BINARY)' -TargetEnvironment '$(DEPLOY_ENV)' -DeploymentId '$(DEPLOY_ID)' -ScpCommand '$(DEPLOY_SCP)' -SshCommand '$(DEPLOY_SSH)'

promote: check-deploy-config
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/promote-jena.ps1 -User '$(DEPLOY_USER)' -HostName '$(DEPLOY_HOST)' -SshCommand '$(DEPLOY_SSH)'
