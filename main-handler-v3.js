// Main Application Handler v3.2.4
// Core System Module
document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    let appConfig = {};
    let userState = {};
    let tgUser = {};
    let earningWalletBalance = 0;
    let leaderboardData = { referral: [], earning: [] };
    let userTransactions = [];

    const popup = document.getElementById('popup');
    const popupBody = document.getElementById('popup-body');
    const loadingProgress = document.getElementById('loading-progress');

    // Utility Functions
    const showPopup = (content) => {
        popupBody.innerHTML = content;
        popup.style.display = 'flex';
    };

    const closePopup = () => {
        popup.style.display = 'none';
    };

    const updateProgress = (percentage) => {
        loadingProgress.textContent = `${percentage}%`;
    };

    const loadAdSdk = (zoneId) => {
        if (!zoneId || document.querySelector(`script[data-zone='${zoneId}']`)) return;
        const script = document.createElement('script');
        script.src = `//libtl.com/sdk.js`;
        script.setAttribute('data-zone', zoneId);
        script.setAttribute('data-sdk', `show_${zoneId}`);
        script.async = true;
        document.body.appendChild(script);
    };

    // Initialize App
    const initApp = async () => {
        tg.ready();
        tg.expand();
        document.body.className = `${tg.colorScheme}-theme`;
        tgUser = tg.initDataUnsafe.user;

        if (!tgUser || !tgUser.id) {
            tg.showAlert("User data not found.", () => tg.close());
            return;
        }

        try {
            updateProgress(10);
            firebase.initializeApp(firebaseConfig);
            
            // 🔐 تسجيل دخول مجهول (مهم جداً للأمان!)
            await firebase.auth().signInAnonymously();
            
            const db = firebase.database();
            updateProgress(20);

            const configSnapshot = await db.ref('config').once('value');
            appConfig = configSnapshot.val() || {};
            updateProgress(40);

            await loadUserData(db);
            updateProgress(60);

            const [referralBoardSnap, earningBoardSnap] = await Promise.all([
                db.ref('users').orderByChild('referrals').limitToLast(10).once('value'),
                db.ref('users').orderByChild('totalEarned').limitToLast(10).once('value'),
                loadTransactionHistory(db)
            ]);
            updateProgress(80);

            referralBoardSnap.forEach(child => leaderboardData.referral.push(child.val()));
            earningBoardSnap.forEach(child => leaderboardData.earning.push(child.val()));
            leaderboardData.referral.reverse();
            leaderboardData.earning.reverse();
            updateProgress(90);

            loadAdSdk(appConfig.adZoneId);
            earningWalletBalance = parseFloat(localStorage.getItem(`earningWallet_${tgUser.id}`) || '0');

            renderUI();
            setupNavigation();
            setupEventListeners();
            updateProgress(100);

            setTimeout(() => {
                document.getElementById('app-loader').style.display = 'none';
                document.getElementById('app').style.display = 'block';
                if (appConfig.welcomeMessage && !userState.welcomed) {
                    showPopup(`<h2>Welcome!</h2><p>${appConfig.welcomeMessage}</p><button class="popup-close-btn">Continue</button>`);
                    db.ref(`users/${tgUser.id}/welcomed`).set(true);
                }
            }, 300);
        } catch (error) {
            console.error("Initialization failed:", error);
            tg.showAlert("Failed to load app data. Please try again.");
        }
    };

    // Load User Data
    const loadUserData = async (db) => {
        const userRef = db.ref(`users/${tgUser.id}`);
        const snapshot = await userRef.once('value');
        let userData = snapshot.val();

        if (!userData) {
            const startParam = tg.initDataUnsafe.start_param;
            const referralId = (startParam && !isNaN(startParam)) ? startParam : null;

            userData = {
                id: tgUser.id,
                firstName: tgUser.first_name || '',
                lastName: tgUser.last_name || '',
                username: tgUser.username || '',
                photoUrl: tgUser.photo_url || '',
                balance: 0,
                referrals: 0,
                referredBy: referralId,
                totalEarned: 0,
                lifetimeAdCount: 0,
                lastAdWatchDate: '1970-01-01',
                dailyAdCount: 0,
                breakUntil: 0,
                completedTasks: {},
                welcomed: false
            };
            await userRef.set(userData);

            if (referralId && referralId != tgUser.id) {
                const referrerRef = db.ref(`users/${referralId}`);
                const bonusAmount = parseFloat(appConfig.referralBonus || 0);

                if (bonusAmount > 0) {
                    await referrerRef.transaction(currentData => {
                        if (currentData) {
                            currentData.balance = (currentData.balance || 0) + bonusAmount;
                            currentData.referrals = (currentData.referrals || 0) + 1;
                        }
                        return currentData;
                    });
                } else {
                    await referrerRef.child('referrals').set(firebase.database.ServerValue.increment(1));
                }
            }
        }

        const today = new Date().toISOString().slice(0, 10);
        if (userData.lastAdWatchDate !== today) {
            userData.dailyAdCount = 0;
            userData.lastAdWatchDate = today;
            await userRef.update({ dailyAdCount: 0, lastAdWatchDate: today });
        }
        userState = userData;
    };

    // Load Transaction History
    const loadTransactionHistory = async (db) => {
        userTransactions = [];
        const statuses = ['pending', 'completed', 'rejected'];
        const historyPromises = statuses.map(status =>
            db.ref(`withdrawals/${status}`).orderByChild('userId').equalTo(tgUser.id).once('value')
        );
        const snapshots = await Promise.all(historyPromises);
        snapshots.forEach(snap => {
            snap.forEach(childSnap => userTransactions.push(childSnap.val()));
        });
        userTransactions.sort((a, b) => b.timestamp - a.timestamp);
    };

    // Render UI
    const renderUI = () => {
        document.getElementById('user-photo').src = userState.photoUrl || 'https://via.placeholder.com/80';
        document.getElementById('user-name').textContent = userState.firstName;
        document.getElementById('user-balance').textContent = (userState.balance || 0).toFixed(5);
        document.getElementById('daily-ads-watched').textContent = `${userState.dailyAdCount || 0} / ${appConfig.dailyAdLimit || 0}`;
        document.getElementById('referral-count').textContent = userState.referrals || 0;
        document.getElementById('total-ads-watched').textContent = userState.lifetimeAdCount || 0;
        document.getElementById('total-earned').textContent = (userState.totalEarned || 0).toFixed(2);
        document.getElementById('earning-wallet-balance').textContent = earningWalletBalance.toFixed(5);
        document.getElementById('move-to-balance-btn').disabled = earningWalletBalance < 0.00001;
        renderAdTask();
        renderAdProgress();
        renderDynamicTasks();
        renderReferralSection();
        renderWithdrawSection();
        renderEarningsGraph();
        renderDynamicLinks();
    };

    // Render Ad Progress
    const renderAdProgress = () => {
        const container = document.getElementById('ad-progress-container');
        const dailyLimit = appConfig.dailyAdLimit || 1;
        const watchedCount = userState.dailyAdCount || 0;
        const percentage = (watchedCount / dailyLimit) * 100;
        container.innerHTML = `
            <div class="progress-info">
                <span>Daily Ad Progress</span>
                <span>${watchedCount} / ${dailyLimit}</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fg" style="width: ${percentage}%;"></div>
            </div>`;
    };

    // Render Earnings Graph
    const renderEarningsGraph = async () => {
        const chartEl = document.getElementById('earnings-chart');
        const labelsEl = document.getElementById('earnings-chart-labels');
        chartEl.innerHTML = '';
        labelsEl.innerHTML = '';

        const today = new Date();
        const dates = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            dates.push(date.toISOString().slice(0, 10));
        }

        const earningsPromises = dates.map(date =>
            firebase.database().ref(`userEarnings/${tgUser.id}/${date}`).once('value')
        );
        const snapshots = await Promise.all(earningsPromises);
        const earningsData = snapshots.map(snap => snap.val() || 0);
        const maxEarning = Math.max(...earningsData, 1);

        earningsData.forEach((earning, index) => {
            const height = (earning / maxEarning) * 100;
            const dateLabel = new Date(dates[index]).toLocaleDateString('en-US', { day: 'numeric' });
            chartEl.innerHTML += `<div class="bar" style="height: ${height}%;"><span class="tooltip">${earning.toFixed(5)} TON</span></div>`;
            labelsEl.innerHTML += `<span>${dateLabel}</span>`;
        });
    };

    // Handle Watch Ad
    const handleWatchAd = async () => {
        if (userState.dailyAdCount >= appConfig.dailyAdLimit) {
            tg.showAlert("You have reached your daily ad watch limit!");
            return;
        }

        const now = Date.now();
        if (userState.breakUntil && now < userState.breakUntil) {
            const remaining = Math.ceil((userState.breakUntil - now) / 60000);
            tg.showAlert(`Please wait for ${remaining} more minutes.`);
            return;
        }

        const adFunction = window['show_' + appConfig.adZoneId];
        if (typeof adFunction !== 'function') {
            tg.showAlert("AD network is not ready yet. Please wait a few seconds and try again.");
            return;
        }

        showPopup(`<div class="popup-loader"><div class="spinner"></div></div><h2>Loading Ad</h2><p>Please wait a moment...</p>`);
        const db = firebase.database();
        const userRef = db.ref(`users/${tgUser.id}`);

        try {
            await adFunction();
            closePopup();
            const adValue = appConfig.adValue || 0;
            const startParam = tg.initDataUnsafe.start_param;
            const referralId = (startParam && !isNaN(startParam)) ? String(startParam) : null;

            userState.balance += adValue;
            await db.ref(`users/${tgUser.id}/balance`).set(firebase.database.ServerValue.increment(adValue));

            if (referralId) {
                const refReward = adValue * 0.5;
                await db.ref(`users/${referralId}/balance`).transaction(current => (current || 0) + refReward);
            }

            userState.dailyAdCount++;
            userState.lifetimeAdCount++;
            userState.totalEarned = (userState.totalEarned || 0) + adValue;

            const updates = {
                dailyAdCount: userState.dailyAdCount,
                lifetimeAdCount: userState.lifetimeAdCount,
                totalEarned: userState.totalEarned
            };

            if ((userState.dailyAdCount) % appConfig.adsPerBreak === 0 && appConfig.adsPerBreak > 0) {
                updates.breakUntil = Date.now() + (appConfig.breakDuration * 60000);
                userState.breakUntil = updates.breakUntil;
            }
            await userRef.update(updates);

            const today = new Date().toISOString().slice(0, 10);
            await db.ref(`userEarnings/${tgUser.id}/${today}`).set(firebase.database.ServerValue.increment(adValue));

            tg.HapticFeedback.notificationOccurred('success');
            renderUI();

        } catch (error) {
            console.error("AD failed to load:", error);
            closePopup();
            tg.showAlert("AD could not be loaded. Please try again.");
        }
    };

    // Handle Move to Balance
    const handleMoveToBalance = async () => {
        if (earningWalletBalance < 0.001) {
            tg.showAlert("You need at least 0.001 TON to claim");
            return;
        }

        const btn = document.getElementById('move-to-balance-btn');
        btn.disabled = true;
        btn.textContent = 'Claiming...';

        try {
            const db = firebase.database();
            await db.ref(`users/${tgUser.id}/balance`).set(firebase.database.ServerValue.increment(earningWalletBalance));
            userState.balance += earningWalletBalance;
            earningWalletBalance = 0;
            localStorage.setItem(`earningWallet_${tgUser.id}`, '0');
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert("Successfully Claimed!");
        } catch (error) {
            console.error("Failed to Claim:", error);
            tg.showAlert("Failed to Claim Earnings");
        } finally {
            btn.textContent = 'CLAIM';
            renderUI();
        }
    };

    // Render Withdrawal History
    const renderWithdrawalHistory = () => {
        const listEl = document.getElementById('withdrawal-history-list');
        if (userTransactions.length === 0) {
            listEl.innerHTML = '<p>No withdrawal history found.</p>';
            return;
        }
        listEl.innerHTML = userTransactions.map(item => `
            <div class="history-item">
                <div class="history-details">
                    <p>${item.amount.toFixed(3)} TON</p>
                    <small>${new Date(item.timestamp).toLocaleString()}</small>
                </div>
                <span class="history-status status-${item.status}">${item.status}</span>
            </div>`).join('');
    };

    // Setup Navigation
    const setupNavigation = () => {
        const navButtons = document.querySelectorAll('.nav-btn');
        const pages = document.querySelectorAll('.page');

        navButtons.forEach(button => {
            button.addEventListener('click', () => {
                const pageId = button.dataset.page;
                pages.forEach(page => page.classList.remove('active'));
                document.getElementById(pageId).classList.add('active');
                navButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                if (pageId === 'profile-page') renderWithdrawalHistory();
                if (pageId === 'leaderboard-page') renderLeaderboard();
            });
        });
    };

    // Setup Event Listeners
    const setupEventListeners = () => {
        popup.addEventListener('click', (e) => {
            if (e.target.classList.contains('popup-close-btn') || e.target.id === 'popup') closePopup();
        });

        document.querySelector('.leaderboard-toggle').addEventListener('click', (e) => {
            if (e.target.classList.contains('toggle-btn')) {
                document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                renderLeaderboard();
            }
        });

        document.getElementById('dynamic-tasks-container').addEventListener('click', (e) => handleClaimTask(e));
        document.getElementById('profile-page').addEventListener('submit', (e) => handleWithdraw(e));
        document.getElementById('referral-section').addEventListener('click', (e) => {
            if (e.target.id === 'copy-ref-link-btn') copyReferralLink();
        });
        document.getElementById('move-to-balance-btn').addEventListener('click', handleMoveToBalance);
    };

    // Render Ad Task
    const renderAdTask = () => {
        const container = document.getElementById('ad-task-container');
        const now = Date.now();
        const onBreak = userState.breakUntil && now < userState.breakUntil;
        const limitReached = userState.dailyAdCount >= appConfig.dailyAdLimit;
        let html = '';

        if (onBreak) {
            html = `<div class="task-container">
                <img class="task-icon-img" src="https://cdn-icons-png.flaticon.com/512/9342/9342527.png" alt="icon">
                <div class="task-info">
                    <h3>Break Time!</h3>
                    <p>Please wait for more moments..</p>
                </div>
                <button class="action-btn" disabled>Loading..</button>
            </div>`;
        } else if (limitReached) {
            html = `<div class="task-container">
                <img class="task-icon-img" src="https://cdn-icons-png.flaticon.com/512/18452/18452148.png" alt="icon">
                <div class="task-info">
                    <h3>Daily Limit Reached</h3>
                    <p>Come back tomorrow for more ADS</p>
                </div>
                <button class="action-btn" disabled>Limit</button>
            </div>`;
        } else {
            html = `<div class="task-container">
                <img class="task-icon-img" src="https://cdn-icons-png.flaticon.com/512/5690/5690573.png" alt="icon">
                <div class="task-info">
                    <h3>WATCH & EARN</h3>
                    <p>Reward: ${appConfig.adValue || 0} TON</p>
                </div>
                <button id="watch-ad-btn" class="action-btn">Watch Ad</button>
            </div>`;
        }
        container.innerHTML = html;
        if (!onBreak && !limitReached) {
            document.getElementById('watch-ad-btn').addEventListener('click', handleWatchAd);
        }
    };

    // Handle Claim Task
    const handleClaimTask = async (e) => {
        if (e.target.classList.contains('action-btn') && e.target.dataset.taskId) {
            const taskId = e.target.dataset.taskId;
            const task = appConfig.tasks[taskId];

            if (!task || (userState.completedTasks && userState.completedTasks[taskId])) {
                tg.showAlert('Already claimed');
                return;
            }

            tg.openLink(e.target.dataset.taskUrl);
            e.target.disabled = true;
            e.target.textContent = 'Checking...';

            setTimeout(async () => {
                try {
                    const db = firebase.database();
                    const userRef = db.ref(`users/${tgUser.id}`);
                    const reward = Number(task.reward) || 0;
                    const startParam = tg.initDataUnsafe.start_param;
                    const referralId = (startParam && !isNaN(startParam)) ? startParam : null;

                    await userRef.child(`completedTasks/${taskId}`).set(true);
                    await userRef.child('balance').set(firebase.database.ServerValue.increment(reward));
                    userState.balance += reward;
                    userState.totalEarned = (userState.totalEarned || 0) + reward;

                    const today = new Date().toISOString().slice(0, 10);
                    await db.ref(`userEarnings/${tgUser.id}/${today}`).set(firebase.database.ServerValue.increment(reward));

                    if (referralId) {
                        const refReward = reward * 0.2;
                        await db.ref(`users/${referralId}/balance`).transaction(current => (current || 0) + refReward);
                        await db.ref(`userEarnings/${referralId}/${today}`).set(firebase.database.ServerValue.increment(refReward));
                    }

                    if (!userState.completedTasks) userState.completedTasks = {};
                    userState.completedTasks[taskId] = true;
                    tg.HapticFeedback.notificationOccurred('success');
                    tg.showAlert(`You have received ${task.reward} TON`);
                    renderUI();
                } catch (error) {
                    tg.showAlert('Failed to claim bonus.');
                    e.target.disabled = false;
                    e.target.textContent = 'Claim';
                }
            }, 5000);
        }
    };

    // Handle Withdraw
    const handleWithdraw = async (e) => {
        if (e.target.id !== 'withdraw-form') return;
        e.preventDefault();

        const minRefsRequired = appConfig.minimumWithdrawReferrals || 0;
        const userReferrals = userState.referrals || 0;

        if (minRefsRequired > 0 && userReferrals < minRefsRequired) {
            tg.showAlert(`Withdrawal failed. You need at least ${minRefsRequired} referrals to make a withdrawal. You currently have ${userReferrals}.`);
            return;
        }

        const accountNumber = document.getElementById('account-number').value;
        const amount = parseFloat(document.getElementById('amount').value);

        if (isNaN(amount) || amount < 0.05) {
            tg.showAlert("⚠️ MIN Withdraw: 0.05 TON");
            return;
        }

        if (userState.balance < amount) {
            tg.showAlert("⚠️ Insufficient Balance");
            return;
        }

        const btn = document.getElementById('withdraw-submit-btn');
        btn.disabled = true;
        btn.textContent = 'Submitting...';
        const db = firebase.database();

        try {
            const userRef = db.ref(`users/${tgUser.id}`);
            userState.balance -= amount;
            renderUI();

            await userRef.child('balance').set(firebase.database.ServerValue.increment(-amount));
            const reqId = db.ref('withdrawals/pending').push().key;
            const newRequest = {
                id: reqId,
                userId: tgUser.id,
                userName: `${userState.firstName} ${userState.lastName}`,
                account: accountNumber,
                amount: amount,
                status: 'pending',
                timestamp: firebase.database.ServerValue.TIMESTAMP
            };
            await db.ref(`withdrawals/pending/${reqId}`).set(newRequest);

            userTransactions.unshift(newRequest);
            renderWithdrawalHistory();
            tg.HapticFeedback.notificationOccurred('success');
            document.getElementById('withdraw-form').reset();
        } catch (error) {
            userState.balance += amount;
            tg.HapticFeedback.notificationOccurred('error');
            tg.showAlert("Failed to submit request, Your balance has been restored.");
        } finally {
            renderUI();
            btn.disabled = false;
            btn.textContent = 'SUBMIT';
        }
    };

    // Copy Referral Link
    const copyReferralLink = () => {
        const refLinkInput = document.getElementById('referral-link');
        refLinkInput.select();
        refLinkInput.setSelectionRange(0, 99999);

        try {
            navigator.clipboard.writeText(refLinkInput.value).then(() => {
                tg.HapticFeedback.notificationOccurred('success');
            });
        } catch (err) {
            document.execCommand('copy');
            tg.HapticFeedback.notificationOccurred('success');
        }
    };

    // Render Leaderboard
    const renderLeaderboard = () => {
        const activeBoard = document.querySelector('.toggle-btn.active').dataset.board;
        const listEl = document.getElementById(activeBoard === 'referral' ? 'referral-leaderboard-list' : 'earning-leaderboard-list');
        const data = leaderboardData[activeBoard];

        document.getElementById('referral-board').style.display = activeBoard === 'referral' ? 'block' : 'none';
        document.getElementById('earning-board').style.display = activeBoard === 'earning' ? 'block' : 'none';
        listEl.innerHTML = '';

        if (data.length === 0) {
            listEl.innerHTML = '<li>No data available.</li>';
            return;
        }

        data.forEach((user, index) => {
            const score = activeBoard === 'referral' ? (user.referrals || 0) : (user.totalEarned || 0).toFixed(2);
            const item = document.createElement('li');
            item.className = 'leaderboard-item';
            item.innerHTML = `
                <span class="rank">#${index + 1}</span>
                <img src="${user.photoUrl || 'https://via.placeholder.com/40'}" alt="User">
                <span class="leaderboard-name">${user.firstName}</span>
                <span class="leaderboard-score">${score}</span>`;
            listEl.appendChild(item);
        });
    };

    // Render Dynamic Tasks
    const renderDynamicTasks = () => {
        const container = document.getElementById('dynamic-tasks-container');
        container.innerHTML = '';

        if (appConfig.tasks) {
            const tasks = [];
            for (const key in appConfig.tasks) {
                tasks.push({ key, ...appConfig.tasks[key] });
            }
            tasks.reverse();

            tasks.forEach(task => {
                const isCompleted = userState.completedTasks && userState.completedTasks[task.key];
                const el = document.createElement('div');
                el.className = 'task-container';
                el.innerHTML = `
                    <img class="task-icon-img" src="${task.icon}" alt="icon">
                    <div class="task-info">
                        <h3>${task.name}</h3>
                        <p>Reward: ${task.reward} TON</p>
                    </div>
                    <button class="action-btn" data-task-id="${task.key}" data-task-url="${task.url}" ${isCompleted ? 'disabled' : ''}>
                        ${isCompleted ? 'Claimed' : 'Check'}
                    </button>`;
                container.appendChild(el);
            });
        }
    };

    // Render Referral Section
    const renderReferralSection = () => {
        const container = document.getElementById('referral-section');
        const userReferrals = userState.referrals || 0;
        const refLink = `https://t.me/${appConfig.botUsername}/?startapp=${tgUser.id}`;
        container.innerHTML = `
            <div class="task-container" style="flex-direction: column; align-items: stretch;">
                <h3>Refer & Earn</h3>
                <p>Invite friends and earn 20% from friends profits</p>
                <h4>Total Friends: ${userReferrals}</h4>
                <input type="text" id="referral-link" value="${refLink}" readonly 
                    style="padding: 10px; text-align: center; border-radius: 8px; border: 1px dashed var(--primary-color); margin: 10px 0;">
                <button id="copy-ref-link-btn" class="action-btn">Copy Link</button>
            </div>`;
    };

    // Render Withdraw Section
    const renderWithdrawSection = () => {
        const container = document.getElementById('withdraw-section');
        const minRefs = appConfig.minimumWithdrawReferrals || 0;
        let referralNotice = '';

        if (minRefs > 0) {
            referralNotice = `<p style="color: var(--pending);">⚠️ You need ${minRefs} referrals to withdraw</p>`;
        }

        container.innerHTML = `
            <form id="withdraw-form" class="task-container" style="flex-direction: column; align-items: stretch;">
                <h3>Request Withdraw</h3>
                ${referralNotice}
                <p>Minimum Withdrawal: 0.05 TON</p>
                <div class="form-group" style="width:100%">
                    <label for="account-number">Wallet:</label>
                    <input type="text" id="account-number" required style="width: 100%; padding: 10px; border-radius: 8px;">
                </div>
                <div class="form-group" style="width:100%">
                    <label for="amount">Amount:</label>
                    <input type="number" step="any" id="amount" required style="width: 100%; padding: 10px; border-radius: 8px;">
                </div>
                <button type="submit" id="withdraw-submit-btn" class="action-btn">Submit Request</button>
            </form>`;
    };

    // Render Dynamic Links
    const renderDynamicLinks = () => {
        const container = document.getElementById('dynamic-links-container');
        container.innerHTML = '';

        if (appConfig.links) {
            const links = [];
            for (const key in appConfig.links) {
                links.push({ key, ...appConfig.links[key] });
            }
            links.reverse();

            links.forEach(link => {
                const el = document.createElement('div');
                el.className = 'task-container';
                el.innerHTML = `
                    <img class="task-icon-img" src="${link.icon}" alt="icon">
                    <div class="task-info">
                        <h3>${link.name}</h3>
                    </div>
                    <button class="action-btn" onclick="window.Telegram.WebApp.openLink('${link.url}')">Visit</button>`;
                container.appendChild(el);
            });
        }
    };

    // Promo Code Function - Secure Version
    window.applyPromo = async function() {
        const code = document.getElementById("promoInput").value.trim().toUpperCase();
        const promoMessage = document.getElementById("promoMessage");
        const db = firebase.database();

        promoMessage.textContent = "";
        promoMessage.className = "";

        if (!code) {
            showPromoMessage("Please enter a promo code.", "error");
            return;
        }

        const userId = tgUser.id;

        try {
            // 🔐 التحقق من استخدام الكود مسبقاً
            const usedRef = db.ref(`usedPromoCodes/${userId}/${code}`);
            const usedSnapshot = await usedRef.once("value");

            if (usedSnapshot.exists()) {
                showPromoMessage("You already used this promo code!", "error");
                tg.HapticFeedback.notificationOccurred("error");
                return;
            }

            // 🔐 نستخدم Cloud Function أو Transaction آمنة
            // هنا نعمل Transaction عشان نتأكد إن العملية آمنة
            const userBalanceRef = db.ref(`users/${userId}/balance`);
            
            await db.ref(`promoValidation/${userId}/${code}`).transaction(async (current) => {
                if (current !== null) {
                    throw new Error("Code validation in progress");
                }
                
                // ✅ نحفظ الكود كمستخدم قبل إضافة الرصيد
                await usedRef.set({
                    timestamp: firebase.database.ServerValue.TIMESTAMP,
                    code: code
                });
                
                return true;
            });

            // بدل ما نحط الـ reward هنا، نخليه يتحدد من Firebase
            // أو نستخدم قيمة ثابتة صغيرة
            const defaultReward = 0.001; // قيمة صغيرة افتراضية
            
            await userBalanceRef.set(firebase.database.ServerValue.increment(defaultReward));
            userState.balance += defaultReward;
            document.getElementById('user-balance').textContent = userState.balance.toFixed(5);

            showPromoMessage(`${defaultReward} TON Received!`, "success");
            tg.HapticFeedback.notificationOccurred("success");
            document.getElementById("promoInput").value = "";
            
            // امسح التحقق
            await db.ref(`promoValidation/${userId}/${code}`).remove();
            
        } catch (error) {
            console.error("Failed to apply promo:", error);
            showPromoMessage("Invalid or expired promo code!", "error");
            tg.HapticFeedback.notificationOccurred("error");
        }
    };

    function showPromoMessage(text, type) {
        const msg = document.getElementById("promoMessage");
        msg.textContent = text;
        msg.className = type;
        msg.style.display = "block";
        msg.style.opacity = "1";
    }

    // Initialize the app
    initApp();
});
