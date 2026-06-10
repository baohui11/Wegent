// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

const { spawn } = require('child_process')
const path = require('path')

process.env.TURBOPACK = '1'

const nextBin = require.resolve('next/dist/bin/next')
const child = spawn(process.execPath, [nextBin, 'dev', '--turbopack'], {
  stdio: 'inherit',
  env: process.env,
  cwd: path.join(__dirname, '..'),
})

child.on('exit', code => {
  process.exit(code ?? 0)
})

child.on('error', error => {
  console.error(error)
  process.exit(1)
})
