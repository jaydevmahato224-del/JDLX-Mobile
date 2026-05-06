#!/bin/bash
PROJECT_ROOT="/home/jaydev/Desktop/JDLX-Mobile"

echo "Starting Backend..."
cd $PROJECT_ROOT/backend
nohup ./venv_linux/bin/python3 app.py > backend-server.out.log 2> backend-server.err.log &
echo $! > ../backend.pid

echo "Starting System Bridge..."
nohup ./venv_linux/bin/python3 system_bridge.py > system_bridge.out.log 2> system_bridge.err.log &
echo $! > system_bridge.pid

echo "Starting Store Frontend..."
cd $PROJECT_ROOT/frontend-store
nohup npm run dev -- --host > store.log 2>&1 &
echo $! > ../frontend-dev.pid

echo "Starting Admin Frontend..."
cd $PROJECT_ROOT/frontend-admin
nohup npm run dev -- --host > admin.log 2>&1 &
echo $! > ../frontend-admin-dev.pid

echo "Starting Warehouse Frontend..."
cd $PROJECT_ROOT/frontend-warehouse
nohup npm run dev -- --host > warehouse.log 2>&1 &
echo $! > ../warehouse-dev.pid

echo "All servers started!"
