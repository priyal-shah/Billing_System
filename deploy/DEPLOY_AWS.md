# Deploying the Grocery Billing app to AWS

**What you get:** one EC2 server in Mumbai (`ap-south-1`) running two Docker containers:

- **web**: Caddy serves the React app, gets and renews a free HTTPS certificate, and forwards `/api` to the backend.
- **backend**: FastAPI.

The database is **MongoDB Atlas**, also on AWS in Mumbai. The site address is a free hostname such as
`https://13-233-10-5.sslip.io`, and you can switch to your own domain later.

**Rough monthly cost:**

| Item | Cost |
|---|---|
| EC2 t3.small | ~$16 |
| 20 GB disk | ~$2 |
| Public IPv4 address | ~$3.6 |
| Atlas M0 | free |
| **Total** | **≈ $22/month** |

Set a budget alert (step B5) so there are no surprises.

> Only you can do the account steps (AWS and Atlas sign-in, passwords, payment details). Everything else is scripted.
> Do **not** run `scripts/seed.py` on the live database. It creates sample users with known passwords.

---

## A. MongoDB Atlas (database)

1. Sign up at <https://www.mongodb.com/cloud/atlas/register> and create a project, e.g. **Billing**.
2. **Create a cluster** with these settings:
   - Tier: **M0 (Free)**
   - Provider: **AWS**
   - Region: **Mumbai (ap-south-1)**
   - Name: `billing-cluster`
3. **Database Access → Add New Database User:**
   - Username: `billing_app`
   - Password: autogenerate one and copy it somewhere safe
   - Role: *Read and write to any database*
4. **Network Access:** leave this for now; you'll add the server's IP in step B4. Don't allow `0.0.0.0/0`.
5. **Connect → Drivers:** copy the connection string. It looks like
   `mongodb+srv://billing_app:<db_password>@billing-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=billing-cluster`

**Backups:** the free M0 tier has **no automatic backups**. Before the shop relies on it, either upgrade the
cluster to **Flex** (daily snapshots, from about $8/month) or run the manual backup in section J regularly.

## B. AWS server (EC2)

1. Sign in to the AWS Console and choose the **Asia Pacific (Mumbai)** region at the top right.
2. **EC2 → Launch instance**, with these settings:
   - Name: `billing-server`
   - AMI: **Ubuntu Server 24.04 LTS** (64-bit x86)
   - Instance type: **t3.small**
   - Key pair: **Create new key pair**, name `billing-key`, type RSA, format `.pem`. Save the downloaded file as
     `C:\Users\<you>\.ssh\billing-key.pem`.
   - Network settings: create a security group that allows:
     - **SSH (22)** from **My IP** only
     - **HTTP (80)** from anywhere
     - **HTTPS (443)** from anywhere
   - Storage: **20 GiB gp3**

   Then click **Launch instance**.
3. **EC2 → Elastic IPs → Allocate Elastic IP address**, then **Actions → Associate** it with `billing-server`.
   Note the IP, e.g. `13.233.10.5`. It stays the same even if you restart the server.
4. Back in **Atlas → Network Access → Add IP Address**, enter `13.233.10.5/32` (your Elastic IP).
5. Recommended: **Billing → Budgets → Create budget**, monthly, e.g. $25, with an email alert.

## C. Protect the key file (Windows, one time)

SSH refuses keys that other Windows users can read. In PowerShell:

```powershell
icacls "$HOME\.ssh\billing-key.pem" /inheritance:r
icacls "$HOME\.ssh\billing-key.pem" /grant:r "$($env:USERNAME):(R)"
```

## D. Prepare the server (one time)

```powershell
cd E:\Billing_System\deploy
scp -i "$HOME\.ssh\billing-key.pem" server-setup.sh ubuntu@13.233.10.5:
ssh -i "$HOME\.ssh\billing-key.pem" ubuntu@13.233.10.5 "bash server-setup.sh"
```

This installs Docker, turns on automatic security updates, and adds swap memory for builds.

## E. Configure

Copy `deploy\.env.example` to `deploy\.env` and fill it in:

| Setting | Value |
|---|---|
| `SITE_ADDRESS` | your Elastic IP with dashes + `.sslip.io`, e.g. `13-233-10-5.sslip.io` |
| `CORS_ORIGINS` | `https://` + the same address |
| `MONGO_URI` | the Atlas string from A5, with the real password in place of `<db_password>` |
| `JWT_SECRET` | output of `python -c "import secrets; print(secrets.token_urlsafe(48))"` |

The app refuses to start if `JWT_SECRET` is missing or weak, or if `MONGO_URI` still points at localhost.

## F. Deploy

```powershell
cd E:\Billing_System\deploy
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Server 13.233.10.5 -Key "$HOME\.ssh\billing-key.pem"
```

The first build takes about 5–10 minutes. Then open `https://13-233-10-5.sslip.io`. If the browser shows a
certificate warning in the first minute, wait and reload while Caddy fetches the certificate.

**To update the site later** (after code changes), run the same command. Your data lives in Atlas and isn't touched.

## G. Create the admin account

This asks for the password you want to use:

```powershell
ssh -t -i "$HOME\.ssh\billing-key.pem" ubuntu@13.233.10.5 "cd ~/billing/deploy && docker compose exec backend python -m scripts.create_admin admin"
```

Run it again any time to reset that admin's password.

## H. Add your products

Either add them in the app (**Products → Add product**), or import a CSV file:

1. Fill in a CSV in the same format as `backend_fastapi\scripts\products_template.csv`, with columns
   `name, category, description, price, unit, gst_rate, in_stock`. Leave `in_stock` empty for items you don't
   track. Excel's *Save As → CSV UTF-8* works.
2. Upload it and check it without saving anything (dry run):
   ```powershell
   scp -i "$HOME\.ssh\billing-key.pem" products.csv ubuntu@13.233.10.5:
   ssh -i "$HOME\.ssh\billing-key.pem" ubuntu@13.233.10.5 "cd ~/billing/deploy && docker compose cp ~/products.csv backend:/tmp/products.csv && docker compose exec backend python -m scripts.import_products /tmp/products.csv --dry-run"
   ```
3. If it lists your products with no errors, run the same second command again without `--dry-run`.

Rows are validated first, and nothing is written if any row has an error. Re-importing updates products
with the same name and category instead of creating duplicates.

## I. Finish setup in the app

- Log in as admin, open **Settings**, and fill in the shop name, address, GSTIN, tax mode and bill format.
- **Guest QR** now points at the live `https://` address automatically, so leave *Public URL* empty. Print it.

## J. Day-to-day

To see logs, use `logs -f --tail 100` (follow the last 100 lines), or `logs backend` / `logs web` for one container.
Replace `<command>` in the pattern below:

```powershell
ssh -i "$HOME\.ssh\billing-key.pem" ubuntu@13.233.10.5 "cd ~/billing/deploy && docker compose <command>"
```

| Task | `<command>` |
|---|---|
| Container status | `ps` |
| Logs | `logs -f --tail 100` |
| Restart | `restart` |

**Manual database backup** saves a dated file in `~/backups` on the server. Download it with `scp`.
Replace `MONGO_URI` with your Atlas string:

```bash
mkdir -p ~/backups && docker run --rm mongo:7 mongodump --uri "MONGO_URI" --db grocery_billing --archive --gzip > ~/backups/billing-$(date +%F).gz
```

**Using your own domain later:** point an `A` record (e.g. `billing.myshop.com`) at the Elastic IP, change
`SITE_ADDRESS` and `CORS_ORIGINS` in `deploy\.env`, and run the deploy script again.

**Security notes:**
- Login, sign-up, guest sessions and order placing are rate-limited per IP address.
- The API docs page (`/docs`) is turned off in production.
- SSH is open only to your IP. If your home IP changes, update the security group's SSH rule in the EC2 console.
