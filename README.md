# how to get this thing working behind a nginx reverse proxy

Start the node app however you normally start the thing.
Note that while in practice you wanna load static content directly with nginx (since thats more efficient) we are not gonna do that here on purpose since we want normal HTTP traffic to be handled by the node app to show the situation where the node-app accepts both normal HTTP traffic and websocket traffic! Just assume our simple static page is in fact a complicated dynamic page ;)

```
server {
    # imitting all the listen statements and possibly ssl stuff since that is server dependend on how that is handled

    location / {
        proxy_pass    http://localhost:PORT/; replace PORT with the port the node app is running on

        # and normally there would be some proxy_set_header lines here to set headers like X-Forwarded-For etc, but our simple node app doesnt need them anyway so im omitting them for this simple example and cuz im lazy
    }
}
```
demo: https://ws-demo1.omkserver.nl/.
Try connecting the websocket, observe concole errors, try also connecting changing the path of the websocket connection.

You'll see with this the simple html page works, however the websocket connection does not. This is because the way websocket works is that it starts as a normal HTTP request, but then gets "upgraded" to a websocket connection via a special `Upgrade` header. Per HTTP spec there are a couple headers marked as hop-by-hop headers, meaning they should *not* be passed along by a proxy server. This makes sense as those headers typically specify details about the actual underlaying TCP connection, for example the `Transfer-Encoding`, `Connection` and `Keep-Alive` headers. And as you might have guessed: the `Upgrade` header also is in this catagory.
So this means that by default, as per HTTP spec, nginx simply drops that header and passes the http request along, which means that the node-server which is looking for that header doesnt see it, and thus does not upgrade the request to a websocket request, and treats it like a normal HTTP request, sending back a normal HTTP response, and any websocket client is request to interpret a normal HTTP response (200, 404, whatever, doesnt matter) as a failure to connect.

The solution is to tell nginx to pass along the `Upgrade` header. There is one problem though: I omited one important detail: the `Upgrade` header is only valid of the `Connection` header has the value "Upgrade". So that means passing along the `Connection` header as well? Problem with that is that normally you actually don't want to do that, as that header only has a direct meaning on the actual TCP connection. Well, except for when we wanna do websockets that is ;)

If you know upfront certain URL's will *always* need to go to the websocket part of the backend, and never return a normal HTTP response, the solution is rather simple. Just introduce a second location block and do it there:

```
server {
    # listen directives and all other stuff
    location / {
        # the same location block as above
        proxy_pass    http://localhost:PORT/; replace PORT with the port the node app is running on
    }

    # our websocket specific location block, since how nginx location blocks work, this means anything *starting* with /ws/ will get handled by this location block, everything else by the block above. Adjust to your needs
    location /ws/ {
        proxy_pass    http://localhost:PORT/; replace PORT with the port the node app is running on

        # we must tell nginx to use http 1.1 since by default it uses http1.0 (cuz reasons idk)
        # and the whole connection/upgrade stuff isnt supported in 1.0
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; # pass along the upgrade header
        proxy_set_header Connection "Upgrade"; # set the connection header to upgrade

        # and here comes all your other usual proxy_set_header statements
    }
}
```
demo: https://ws-demo2.omkserver.nl/.
Try connecting the websocket, first on the default path, then with the path wss://ws-demo2.omkserver.nl/ws/something

You'll see that the websocket indeed does not connect on any path except if it starts with /ws/ and then it behaves as expected.

Now what if you do not have a path exclusivly reserved for websockets? (or you do not know the path in advance) Then we have to do things a little more complicated: we have to set the `Connection` header to "Upgrade" *if and only if* the `Upgrade` header has a value! The way we do this is to use a nginx map (http://nginx.org/en/docs/http/ngx_http_map_module.html). This thing is a little weird, but here we go:
```
map $http_upgrade $out_special_http_upgrade_map {
    default upgrade;
    '' close;
}
```
so how you should read this is as follows: here we declare a variable with the name $out_special_http_upgrade_map. The concent of this variable is a map, that *when used* will read the variable $http_upgrade (which contains the value of the `Upgrade` header in the incoming HTTP request) in the following way:
* if it is an empty string (aka does not exist): map to the value "close"
* if anything else (the `default` is a keyword here, not a value) map to the value "upgrade"

Here is how we use it:
```
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name ws-demo3.omkserver.nl;

    access_log /var/log/nginx/ws-demo.omkserver.nl/access.log;
    error_log  /var/log/nginx/ws-demo.omkserver.nl/error.log;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $out_special_http_upgrade_map;
    }
}
```
We just always pass along the `Upgrade` header, thats fine, it either contains a value or does not, either case we wanna pass that along. Now for the `Connection` header, here we use the map. So we set the *value* of the `Connection` header according to our map: if *in this request* the *value* of the `Upgrade` header is empty (which in practice means we do not have an upgrade) set the value to "Close", otherwise set the value to "Upgrade" (like we did in our previous example where we always set the value to "Upgrade").

demo: https://ws-demo3.omkserver.nl/

Now we can start a websocket connection on any path, while still being able to serve normal HTTP request on any path!

Now you might ask: why set the `Connection` header value to "Close", wouldnt we wanna keep the TCP connection between nginx and the node-app open? Well yes, but if we didnt do anything, (and thus didnt specify the proxy_http_version 1.1; line) we would have been using HTTP 1.0 anyway, and that always closes the TCP connection after one request. So we are actually not doing anything we didnt already do before! You could very well not set the `Connection: Close` header (just change `'' close` to `'' ''` in the map) and it'll just work fine, but I dont expect nginx to actually keep the socket alive anyway (since by default it does not do that) so might as well give it the Close value.

However, you can tell nginx to keep the TCP socket alive, but that does require a bunch of extra configuration that goes beyond the scope of this wall of text :D