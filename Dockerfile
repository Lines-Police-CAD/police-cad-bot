FROM node:alpine

# Create bot directory
RUN mkdir -p /usr/src/bot
WORKDIR /usr/src/bot

COPY package.json /usr/src/bot
RUN npm install

COPY . /usr/src/bot

# Run the bot
CMD ["node", "index.js"]