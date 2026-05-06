package main

import "time"

const jwtSecretEnvKey = "CLAMAI_JWT_SECRET"

const accessTokenExpiry = 2 * time.Hour

const refreshTokenExpiry = 30 * 24 * time.Hour
