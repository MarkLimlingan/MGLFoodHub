<?php
// MGL Food Hub API settings. On Hostinger this file is
//   domains/mglfoodhub.com/mgl-config.php   (next to public_html, NOT inside it)
// so deploys from GitHub never touch it and it is never in the repository.
// Create it once in hPanel → Files → File Manager. The API finds it by looking
// in each folder above public_html/api.
return [
    // hPanel → Databases → MySQL Databases. From the website itself the host is localhost.
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'u406950319_MGLFOODHUB',
        'user' => 'u406950319_mglfoodhub',
        'password' => 'CHANGE_ME',
    ],

    // Google Cloud Console → APIs & Services → Credentials → OAuth client (Web).
    // Authorized redirect URI: https://mglfoodhub.com/checkout
    'google_client_id' => 'CHANGE_ME.apps.googleusercontent.com',

    // Used once, to create the first admin (admin login → First time setup). Then you can blank it.
    'setup_key' => 'CHANGE_ME_long_and_random',

    // Payment screenshots and admin photo uploads: next to this file, outside public_html.
    'storage_dir' => __DIR__ . '/mgl-data/proofs',
    'uploads_dir' => __DIR__ . '/mgl-data/uploads',

    // Order confirmation emails (Admin → Settings → Email notifications).
    // Create this mailbox in hPanel → Emails first.
    'mail_from' => 'MGL Food Hub <orders@mglfoodhub.com>',
    'site_url' => 'https://mglfoodhub.com',

    // Only needed to call the live API from npm run dev.
    'allowed_origins' => [],
];
