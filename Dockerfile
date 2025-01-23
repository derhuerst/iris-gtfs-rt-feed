# syntax=docker/dockerfile:1.10
# ^ needed for ADD --checksum=…

FROM node:22-alpine
WORKDIR /app

LABEL org.opencontainers.image.title="iris-gtfs-rt-feed"
LABEL org.opencontainers.image.description="Matches realtime transit data from Deutsche Bahn's IRIS API against GTFS Schedule, producing GTFS Realtime 
       │ data."
LABEL org.opencontainers.image.authors="Jannis R <mail@jannisr.de>"

# install dependencies
ADD package.json /app
RUN npm install --production

# add source code
ADD . /app

CMD [ "node", "index.js"]
