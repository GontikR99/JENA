# Copy this file to deploy.local.mk and edit it for your deployment target.
# deploy.local.mk is ignored by git. You can also pass these values directly:
#   make deploy DEPLOY_USER=my-user DEPLOY_HOST=my-host

DEPLOY_USER ?= your-user
DEPLOY_HOST ?= your-host
DEPLOY_REMOTE_BINARY ?= /tmp/jena-backend
DEPLOY_ENV ?= test

# Override these if ssh/scp are not on PATH or installed in a standard Windows OpenSSH location.
DEPLOY_SCP ?= scp
DEPLOY_SSH ?= ssh
