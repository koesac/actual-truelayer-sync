FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.js ./
ENV DATA_DIR=/app/data
EXPOSE 3099
CMD ["node", "server.js"]
