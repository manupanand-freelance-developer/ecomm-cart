FROM    docker.io/redhat/ubi9-minimal:latest

RUN     microdnf install tar xz  -y
RUN     cd /opt && curl -L https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz | tar -xJ

ENV     PATH="/opt/node-v22.14.0-linux-x64/bin:$PATH"

RUN     mkdir /app

WORKDIR /app

COPY    package.json server.js /app/

RUN     npm install

ENTRYPOINT [ "bash" ,"run.sh"]
