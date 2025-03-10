#!/usr/bin/env bash

set -eo pipefail

if ! command -v jq &> /dev/null
then
    echo "jq is not installed and is required by the release script. Install it through homebrew or your package manager of choice."
    exit
fi

DEPLOY_ENDPOINT_URL="https://circleci.com/api/v1.1/project/github/expo/turtle-cli-example/tree/updates-do-not-remove-me"

curl -X POST \
    --header "Content-Type: application/json" \
    -u $CIRCLE_API_USER_TOKEN: \
    -d '
      {
        "build_parameters": {
          "CIRCLE_JOB": "update",
          "TURTLE_TAG": "latest"
        }
      }' \
    $DEPLOY_ENDPOINT_URL 2>/dev/null | jq -r .build_url
