import AddressForm from "./AddressForm";

function AddressModal({
  show,
  onClose,
  onSubmit,
  initialData,
  loading,
}) {
    if (!show) return null;

    return (
        <div className="address-modal-overlay">
            <div className="address-modal">
                <div className="address-modal-header">
                    <h2>{initialData ? "Edit Address" : "Add New Address"}</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>
            <AddressForm
                show={show}
                onClose={onClose}
                onSave={onSubmit}
                initialData={initialData}
                loading={loading}
            />
            </div>
        </div>
    );
}

export default AddressModal;
