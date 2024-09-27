## Under the hood
The intended way of writing a tailscale client is to query the `tailscaled`. This allows clients to process structured json data straight from the tailscale daemon. We can query the daemon over the default socket `/var/run/tailscale/tailscaled.sock` and if we use the `/localapi/v0/...` prefix we can query one of many [available api endpoints](https://github.com/tailscale/tailscale/blob/main/ipn/localapi/localapi.go#L76). The following curl request will return the same as `tailscale status` but in structured json and we can now craft HTTP requests to provide the underlying functionality of the client.

``` sh
curl -H "Content-Type: application/json" -X GET --unix-socket /var/run/tailscale/tailscaled.sock http://local-tailscaled.sock/localapi/v0/status
```

Furthermore, in order to recreate the right http requests we can inspect the bytes going through the tailscale socket with `socat`:
``` sh

mv /var/run/tailscale/tailscaled.sock /var/run/tailscale/tailscaled.sock.original
socat -t100 -x -v UNIX-LISTEN:/var/run/tailscale/tailscaled.sock,mode=777,reuseaddr,fork UNIX-CONNECT:/var/run/tailscale/tailscaled.sock.original
```

Then, using the tailscale cli we can correctly craft the right HTTP requests programmatically.



## password-less command
`tailscale up --operator=$USER || pkexec tailscale up --operator=$USER`