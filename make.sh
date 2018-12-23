#! /usr/bin/env bash
cd "$(dirname $0)"
./convert.js
if [ $? -ne 0 ]; then
    exit 1
fi
cd ddk
make
