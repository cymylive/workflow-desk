package com.cymylive.workflowdesk;

import com.getcapacitor.BridgeActivity;

/**
 * 保持默认实现。
 *
 * 关键点：本项目的 targetSdk = 34，Android 15+ 不会强制 edge-to-edge，
 * 系统会自动为状态栏和导航栏留出空间，WebView 从状态栏下方开始渲染。
 * 因此无需任何 insets 处理代码。
 */
public class MainActivity extends BridgeActivity {}
