#!/bin/bash

# Colors for better visibility
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting JDLX-Mobile Development Environment...${NC}"

# Function to kill all background processes on exit
cleanup() {
    echo -e "\n${PURPLE}🛑 Shutting down all servers...${NC}"
    kill $BACKEND_PID $STORE_PID $ADMIN_PID $WAREHOUSE_PID
    exit
}

trap cleanup SIGINT

# 1. Start Backend
echo -e "${GREEN}📡 Starting Backend Server...${NC}"
cd backend
./venv_linux/bin/python3 app.py &
BACKEND_PID=$!
cd ..

# 2. Start Store Frontend
echo -e "${CYAN}🛒 Starting Store Frontend...${NC}"
cd frontend-store
npm run dev -- --host &
STORE_PID=$!
cd ..

# 3. Start Admin Frontend
echo -e "${GREEN}⚙️ Starting Admin Panel...${NC}"
cd frontend-admin
npm run dev -- --host &
ADMIN_PID=$!
cd ..

# 4. Start Warehouse Frontend
echo -e "${PURPLE}📦 Starting Warehouse Panel...${NC}"
cd frontend-warehouse
npm run dev -- --host &
WAREHOUSE_PID=$!
cd ..

echo -e "${BLUE}✅ All systems are running! Press Ctrl+C to stop everything.${NC}"
wait
