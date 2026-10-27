package com.supplychain.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Collections;
import java.util.Enumeration;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class InternalServiceAuthenticationFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-Internal-Service-Token";
    private static final Pattern TOKEN_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,128}");

    private final byte[] expectedToken;

    public InternalServiceAuthenticationFilter(
            @Value("${inventory.internal.token:}") String token) {
        if (!isValidToken(token)) {
            throw new IllegalStateException(
                    "INVENTORY_SERVICE_TOKEN must be a 32-byte-or-stronger base64url secret");
        }
        this.expectedToken = token.getBytes(StandardCharsets.US_ASCII);
    }

    private static boolean isValidToken(String token) {
        if (token == null || !TOKEN_PATTERN.matcher(token).matches()) {
            return false;
        }
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(token);
            String canonicalToken = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(decoded);
            return decoded.length >= 32 && canonicalToken.equals(token);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getServletPath();
        return "/health/live".equals(path)
            || "/health/ready".equals(path);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        Enumeration<String> values = request.getHeaders(HEADER_NAME);
        if (values == null) {
            reject(response);
            return;
        }

        var headers = Collections.list(values);
        if (headers.size() != 1) {
            reject(response);
            return;
        }

        String suppliedToken = headers.get(0);
        if (!isValidToken(suppliedToken)
                || !MessageDigest.isEqual(
                        expectedToken,
                        suppliedToken.getBytes(StandardCharsets.US_ASCII))) {
            reject(response);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private void reject(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"unauthorized\"}");
    }
}
