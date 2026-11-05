import { h } from '../harness.js';

export default {
    UserDirectory: { DIRECTORY_DOWNLOAD: 2 },
    get_user_special_dir: () => h.downloadsDir,
    get_user_name: () => h.userName,
};
