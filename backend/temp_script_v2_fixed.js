// Emergency GB Repair Fix - Clean version
// This file contains only the fixed parts to be merged

// Fixed renderPage() case tasks
function renderPage() {
    const content = document.getElementById('pageContent');

    switch(currentPage) {
        case 'login':
            content.innerHTML = getLoginHTML();
            initializeLoginPage();
            break;
        case 'overview':
            content.innerHTML = getOverviewHTML();
            initializeOverviewPage();
            break;
        case 'nodes':
            content.innerHTML = getNodesHTML();
            initializeNodesPage();
            break;
        case 'rewards':
            content.innerHTML = getRewardsHTML();
            initializeRewardsPage();
            break;
        case 'referrals':
            content.innerHTML = getReferralsHTML();
            initializeReferralsPage();
            break;
        case 'profile':
            content.innerHTML = getProfileHTML();
            initializeProfilePage();
            break;
        case 'shop':
            content.innerHTML = getShopHTML();
            initializeShopPage();
            break;
        case 'enterpriseApi':
            content.innerHTML = getEnterpriseApiHTML();
            initializeEnterpriseApiPage();
            break;
        case 'tasks':
            content.innerHTML = getTasksHTML();
            initializeTasksPage();
            break;
        case 'adminTasks':
            content.innerHTML = getAdminTasksHTML();
            initializeAdminTasksPage();
            break;
    }
}

// Fixed initializeAdminLeaderboardPage() emergency button
function initializeAdminLeaderboardPage() {
    const token = localStorage.getItem('token');
    fetch(`${API_BASE}/api/admin/leaderboard`, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(r => r.json())
    .then(data => {
        const tbody = document.querySelector('#admin-leaderboard-table tbody');
        const rows = (data.users || []).map(u => `
            <tr>
                <td><button class="link-btn" data-id="${u.id}">${u.username}</button></td>
                <td>${u.email || ''}</td>
                <td>${u.grade || '-'}</td>
                <td>${u.points || 0}</td>
                <td>${u.referral_count || 0}</td>
                <td>${u.tasks_completed || 0}</td>
                <td>${u.active_hours || 0}</td>
                <td>${u.final_airdrop_score || 0}</td>
                <td>
                    <button class="profile-btn" data-action="reset" data-id="${u.id}">Reset crédits</button>
                    <button class="profile-btn" data-action="override" data-id="${u.id}">Override grade</button>
                </td>
            </tr>
        `).join('');
        tbody.innerHTML = rows || '';
        tbody.querySelectorAll('button.link-btn').forEach(b => {
            b.addEventListener('click', () => showUserDetail(b.getAttribute('data-id')));
        });
        tbody.querySelectorAll('button.profile-btn').forEach(b => {
            b.addEventListener('click', () => {
                const action = b.getAttribute('data-action');
                const id = b.getAttribute('data-id');
                if (action === 'reset') {
                    fetch(`${API_BASE}/api/admin/users/${id}/reset-credits`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }});
                } else if (action === 'override') {
                    const grade = prompt('Nouveau grade (Bronze/Silver/Gold/Platinum/Diamond):');
                    if (grade) {
                        fetch(`${API_BASE}/api/admin/users/${id}/override-grade`, { method: 'POST', headers: { 'Content-Type':'application/json','Authorization': `Bearer ${token}` }, body: JSON.stringify({ grade }) });
                    }
                }
            });
        });
        const closeBtn = document.getElementById('close-user-detail');
        if (closeBtn) closeBtn.addEventListener('click', () => {
            document.getElementById('user-detail-modal').classList.remove('open');
        });

        // Emergency GB repair button - FIXED VERSION
        const emergencyBtnV2 = document.getElementById('emergency-gb-repair-v2');

        if (emergencyBtnV2) {
            emergencyBtnV2.addEventListener('click', async () => {
                if (!confirm('...')) {
                    return;
                }

                const originalText = emergencyBtnV2.innerHTML;
                emergencyBtnV2.innerHTML = '...';
                emergencyBtnV2.disabled = true;

                try {
                    const token = localStorage.getItem('token');
                    const response = await fetch(`${API_BASE}/api/admin/emergency/fix-all-gb`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const result = await response.json();

                    if (result.success) {
                        emergencyBtnV2.innerHTML = '...';
                        emergencyBtnV2.style.background = '...';
                        alert(`...`);
                    } else {
                        throw new Error(result.error || '...');
                    }
                } catch (error) {
                    emergencyBtnV2.innerHTML = '...';
                    alert(`...`);
                }

                setTimeout(() => {
                    emergencyBtnV2.innerHTML = originalText;
                    emergencyBtnV2.disabled = false;
                    emergencyBtnV2.style.background = '...';
                }, 5000);
            });
        }
    }).catch(() => {});
}
