package com.cymylive.workflowdesk;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class NetworkUtils {

    /** 返回本机所有非回环 IPv4 地址 */
    public static List<String> lanIps() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        out.add(addr.getHostAddress());
                    }
                }
            }
        } catch (Exception e) {
            // ignore
        }
        return out;
    }

    /** 返回第一个局域网 IP，没有则返回 null */
    public static String firstLanIp() {
        List<String> ips = lanIps();
        return ips.isEmpty() ? null : ips.get(0);
    }
}
