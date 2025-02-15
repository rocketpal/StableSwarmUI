#!/usr/bin/env bash

export CUDA_VISIBLE_DEVICES=$1
export COMMANDLINE_ARGS=$4

cd "$2"

export PYTHONUNBUFFERED=true

if [[ $5 == py ]]; then
    if test -f "venv/bin/activate"; then
        source "venv/bin/activate"
    fi
    python3 "$3" $4
else
    "./$3" $4
fi
