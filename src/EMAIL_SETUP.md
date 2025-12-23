# Email Notification Setup

## Overview

The scheduled scraper (`runScheduled.sh`) can send email notifications after each run with:
- Number of records added
- Total record count
- Webapp reload status
- Link to log file

## Quick Setup

### Option 1: Set Environment Variable in Cron

```bash
crontab -e

# Add email address before the cron command:
NOTIFICATION_EMAIL=your.email@mit.edu
0 8 * * * cd /path/to/mit-brain-app-v04/src && ./runScheduled.sh >> ../logs/cron.log 2>&1
```

### Option 2: Set in Script

Edit `runScheduled.sh`:

```bash
# At the top of the file, change:
NOTIFICATION_EMAIL=${NOTIFICATION_EMAIL:-""}

# To:
NOTIFICATION_EMAIL=${NOTIFICATION_EMAIL:-"your.email@mit.edu"}
```

### Option 3: Pass as Environment Variable

```bash
NOTIFICATION_EMAIL=your.email@mit.edu ./runScheduled.sh
```

## Email Configuration

### macOS

Mail should work out of the box for local delivery. For external email:

```bash
# Test mail command
echo "Test" | mail -s "Test Subject" your.email@mit.edu

# If it doesn't work, configure postfix:
sudo vim /etc/postfix/main.cf

# Add:
relayhost = [smtp.gmail.com]:587
smtp_sasl_auth_enable = yes
smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
smtp_sasl_security_options = noanonymous
smtp_use_tls = yes

# Create password file:
sudo vim /etc/postfix/sasl_passwd
# Add:
[smtp.gmail.com]:587 your.email@gmail.com:your-app-password

# Secure it:
sudo postmap /etc/postfix/sasl_passwd
sudo chmod 600 /etc/postfix/sasl_passwd
sudo chmod 600 /etc/postfix/sasl_passwd.db

# Restart postfix:
sudo postfix reload
```

### Linux (Ubuntu/Debian)

```bash
# Install mailutils
sudo apt-get install mailutils

# Test
echo "Test" | mail -s "Test" your.email@mit.edu

# For external SMTP, configure postfix (same as macOS above)
```

## Email Content Example

```
Subject: MIT Brain Update: 47 new records

---

MIT Brain Daily Update Complete

Scraping Results:
- Records added: 47
- Total records: 9341
- Start date filter: 2024-12-18

Statistics:
- Initial count: 9294
- After scraping: 9341
- After enrichment: 9341

Webapp Status:
- Reloaded: Yes

Log file: /path/to/logs/scheduled_mit_brain_test17_20241220_080000.log

---
MIT Brain Automated Daily Run
Fri Dec 20 08:15:23 EST 2024
```

## Notification Conditions

Email is sent **only when**:
- `NOTIFICATION_EMAIL` is set
- `RECORDS_ADDED > 0` (at least one new record)

This prevents spam when nothing changes.

## Customization

### Change Email Format

Edit `runScheduled.sh`, find the email section:

```bash
EMAIL_BODY="MIT Brain Daily Update Complete

Scraping Results:
- Records added: ${RECORDS_ADDED}
...
"
```

Customize the message as needed.

### Add Attachments

To attach the log file:

```bash
# Instead of:
echo "$EMAIL_BODY" | mail -s "$EMAIL_SUBJECT" "$NOTIFICATION_EMAIL"

# Use:
echo "$EMAIL_BODY" | mail -s "$EMAIL_SUBJECT" -A "$LOG_FILE" "$NOTIFICATION_EMAIL"
```

### HTML Email

For HTML formatting:

```bash
EMAIL_BODY="<html>
<body>
<h2>MIT Brain Daily Update</h2>
<p><strong>Records added:</strong> ${RECORDS_ADDED}</p>
<p><strong>Total records:</strong> ${FINAL_COUNT}</p>
</body>
</html>"

echo "$EMAIL_BODY" | mail -s "$EMAIL_SUBJECT" -a "Content-Type: text/html" "$NOTIFICATION_EMAIL"
```

### Multiple Recipients

```bash
NOTIFICATION_EMAIL="user1@mit.edu,user2@mit.edu,user3@mit.edu"
```

Or loop:

```bash
for email in user1@mit.edu user2@mit.edu; do
    echo "$EMAIL_BODY" | mail -s "$EMAIL_SUBJECT" "$email"
done
```

## Alternative: External Email Service

If `mail` command is problematic, use an external service:

### Using curl with Mailgun

```bash
curl -s --user "api:YOUR_MAILGUN_API_KEY" \
    https://api.mailgun.net/v3/YOUR_DOMAIN/messages \
    -F from="MIT Brain <noreply@yourdomain.com>" \
    -F to="$NOTIFICATION_EMAIL" \
    -F subject="$EMAIL_SUBJECT" \
    -F text="$EMAIL_BODY"
```

### Using curl with SendGrid

```bash
curl -s -X POST https://api.sendgrid.com/v3/mail/send \
    -H "Authorization: Bearer YOUR_SENDGRID_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
        "personalizations": [{"to": [{"email": "'"$NOTIFICATION_EMAIL"'"}]}],
        "from": {"email": "noreply@yourdomain.com"},
        "subject": "'"$EMAIL_SUBJECT"'",
        "content": [{"type": "text/plain", "value": "'"$EMAIL_BODY"'"}]
    }'
```

### Using Python Script

Create `send_notification.py`:

```python
#!/usr/bin/env python3
import smtplib
import sys
from email.mime.text import MIMEText

def send_email(to_email, subject, body):
    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = 'mitbrain@yourdomain.com'
    msg['To'] = to_email
    
    # Use Gmail SMTP
    server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
    server.login('your.email@gmail.com', 'your-app-password')
    server.send_message(msg)
    server.quit()

if __name__ == '__main__':
    send_email(sys.argv[1], sys.argv[2], sys.stdin.read())
```

Then in script:

```bash
echo "$EMAIL_BODY" | python3 send_notification.py "$NOTIFICATION_EMAIL" "$EMAIL_SUBJECT"
```

## Testing

### Test Email System

```bash
# Simple test
echo "Test from MIT Brain" | mail -s "Test" your.email@mit.edu

# Check if it worked
tail /var/mail/$(whoami)  # Local delivery
# Or check your inbox for external delivery
```

### Test Notification from Script

```bash
cd src/

# Set email and run
NOTIFICATION_EMAIL=your.email@mit.edu ./runScheduled.sh

# Or add to environment
export NOTIFICATION_EMAIL=your.email@mit.edu
./runScheduled.sh
```

### Dry Run (See Email Without Sending)

In `runScheduled.sh`, replace:

```bash
echo "$EMAIL_BODY" | mail -s "$EMAIL_SUBJECT" "$NOTIFICATION_EMAIL"
```

With:

```bash
echo "Would send email:"
echo "To: $NOTIFICATION_EMAIL"
echo "Subject: $EMAIL_SUBJECT"
echo "$EMAIL_BODY"
```

## Troubleshooting

### Mail command not found

```bash
# macOS: Should be installed by default
which mail

# Linux: Install mailutils
sudo apt-get install mailutils
```

### Email not received

```bash
# Check mail logs
tail -f /var/log/mail.log  # Linux
log show --predicate 'process == "smtp"' --last 1h  # macOS

# Check postfix queue
mailq

# Test postfix
sudo postfix check
```

### Permission denied

```bash
# Make sure user can send mail
sudo chmod 755 /usr/sbin/sendmail
```

## Summary

**Simplest setup:**
```bash
# In crontab -e:
NOTIFICATION_EMAIL=your.email@mit.edu
0 8 * * * cd /path/to/src && ./runScheduled.sh
```

**Email sent when:**
- At least 1 new record added
- After scraping and enrichment complete
- Contains summary statistics

**No email when:**
- No new records (prevents spam)
- NOTIFICATION_EMAIL not set

Perfect for monitoring daily runs! 📧
